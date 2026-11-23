-- Etapa 4: administración de usuarios desde la app (rol Administración) y cambio de la
-- propia contraseña. Los usuarios no se borran: se desactivan. Cada cambio queda en la
-- bitácora. Las contraseñas se guardan cifradas por Supabase Auth; la app nunca las lee.

alter table bitacora add column usuario_afectado uuid references perfiles (id);
create index bitacora_usuario_idx on bitacora (usuario_afectado, ts) where usuario_afectado is not null;

create function anotar_usuario(p perfiles, afectado uuid, accion text, motivo text default null)
returns void language sql security definer set search_path = public as $$
  insert into bitacora (usuario_afectado, usuario_id, usuario_nombre, rol, accion, motivo)
  values (afectado, p.id, p.nombre, etiqueta_rol(p.rol), accion, nullif(trim(motivo), ''))
$$;

create function validar_clave(c text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if c is null or length(c) < 10 then
    raise exception 'La contraseña debe tener al menos 10 caracteres.' using errcode = 'P0001';
  end if;
  if length(c) > 72 then
    raise exception 'La contraseña es demasiado larga (máximo 72 caracteres).' using errcode = 'P0001';
  end if;
  if c !~ '[A-Za-z]' or c !~ '[0-9]' then
    raise exception 'La contraseña debe combinar letras y números.' using errcode = 'P0001';
  end if;
end $$;

-- Lista de usuarios con su correo y último acceso (solo Administración).
create function listar_usuarios()
returns table (id uuid, nombre text, email text, rol rol_area, activo boolean, creado_en timestamptz, ultimo_acceso timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform exigir_rol('admin');
  return query
    select p.id, p.nombre, u.email::text, p.rol, p.activo, p.creado_en, u.last_sign_in_at
    from perfiles p join auth.users u on u.id = p.id
    order by p.activo desc, p.rol, p.nombre;
end $$;

create function crear_usuario(p_email text, p_clave text, p_nombre text, p_rol rol_area) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  p perfiles;
  correo text := lower(trim(coalesce(p_email, '')));
  nom text := trim(coalesce(p_nombre, ''));
  uid uuid := gen_random_uuid();
begin
  p := exigir_rol('admin');
  if correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(correo) > 200 then
    raise exception 'Escribe un correo válido.' using errcode = 'P0001';
  end if;
  if length(nom) < 2 or length(nom) > 120 then
    raise exception 'Escribe el nombre completo.' using errcode = 'P0001';
  end if;
  if p_rol is null then raise exception 'Elige el área.' using errcode = 'P0001'; end if;
  perform validar_clave(p_clave);
  if exists (select 1 from auth.users where lower(email) = correo) then
    raise exception 'Ya existe un usuario con ese correo.' using errcode = 'P0001';
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', correo,
    crypt(p_clave, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', correo, 'email_verified', true),
          'email', null, now(), now());
  insert into perfiles (id, nombre, rol) values (uid, nom, p_rol);
  perform anotar_usuario(p, uid, 'Dio de alta al usuario ' || nom || ' (' || correo || ') en ' || etiqueta_rol(p_rol));
  return uid;
end $$;

create function cambiar_area_usuario(p_usuario uuid, p_rol rol_area) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; u perfiles;
begin
  p := exigir_rol('admin');
  select * into u from perfiles where id = p_usuario for update;
  if u.id is null then raise exception 'El usuario no existe.' using errcode = 'P0002'; end if;
  if u.id = p.id then raise exception 'No puedes cambiar tu propia área.' using errcode = 'P0001'; end if;
  if p_rol is null then raise exception 'Elige el área.' using errcode = 'P0001'; end if;
  if u.rol = p_rol then return; end if;
  update perfiles set rol = p_rol where id = u.id;
  perform anotar_usuario(p, u.id, 'Cambió el área de ' || u.nombre || ': ' || etiqueta_rol(u.rol) || ' → ' || etiqueta_rol(p_rol));
end $$;

create function activar_usuario(p_usuario uuid, p_activo boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; u perfiles; m text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  p := exigir_rol('admin');
  select * into u from perfiles where id = p_usuario for update;
  if u.id is null then raise exception 'El usuario no existe.' using errcode = 'P0002'; end if;
  if u.id = p.id then raise exception 'No puedes desactivar tu propio usuario.' using errcode = 'P0001'; end if;
  if not p_activo and (m is null or length(m) < 3) then
    raise exception 'Escribe el motivo.' using errcode = 'P0001';
  end if;
  if u.activo = p_activo then return; end if;
  update perfiles set activo = p_activo where id = u.id;
  -- Al desactivar se cierran sus sesiones abiertas.
  if not p_activo then
    delete from auth.sessions where user_id = u.id;
  end if;
  perform anotar_usuario(p, u.id,
    case when p_activo then 'Reactivó al usuario ' else 'Desactivó al usuario ' end || u.nombre, m);
end $$;

create function restablecer_clave(p_usuario uuid, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p perfiles; u perfiles;
begin
  p := exigir_rol('admin');
  select * into u from perfiles where id = p_usuario;
  if u.id is null then raise exception 'El usuario no existe.' using errcode = 'P0002'; end if;
  perform validar_clave(p_clave);
  update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf')), updated_at = now() where id = u.id;
  if u.id <> p.id then
    delete from auth.sessions where user_id = u.id;
  end if;
  perform anotar_usuario(p, u.id, 'Restableció la contraseña de ' || u.nombre);
end $$;

-- Cualquier usuario activo puede cambiar su propia contraseña con la actual.
create function cambiar_mi_clave(p_actual text, p_nueva text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p perfiles; hash text;
begin
  select * into p from perfiles where id = auth.uid() and activo;
  if p.id is null then raise exception 'Tu usuario no tiene acceso a Taxzero.' using errcode = '42501'; end if;
  select encrypted_password into hash from auth.users where id = p.id;
  if hash is null or crypt(coalesce(p_actual, ''), hash) <> hash then
    raise exception 'La contraseña actual no es correcta.' using errcode = 'P0001';
  end if;
  if p_nueva = p_actual then
    raise exception 'La nueva contraseña debe ser distinta de la actual.' using errcode = 'P0001';
  end if;
  perform validar_clave(p_nueva);
  update auth.users set encrypted_password = crypt(p_nueva, gen_salt('bf')), updated_at = now() where id = p.id;
  perform anotar_usuario(p, p.id, 'Cambió su contraseña');
end $$;

-- Bitácora de usuarios: solo Administración la ve (la política general ya filtra por rol).
create function bitacora_usuarios()
returns table (ts timestamptz, usuario_nombre text, rol text, accion text, motivo text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform exigir_rol('admin');
  return query
    select b.ts, b.usuario_nombre, b.rol, b.accion, b.motivo from bitacora b
    where b.usuario_afectado is not null order by b.ts desc, b.id desc limit 200;
end $$;

revoke execute on function anotar_usuario(perfiles, uuid, text, text), validar_clave(text),
  listar_usuarios(), crear_usuario(text, text, text, rol_area), cambiar_area_usuario(uuid, rol_area),
  activar_usuario(uuid, boolean, text), restablecer_clave(uuid, text), cambiar_mi_clave(text, text),
  bitacora_usuarios()
  from public, anon;
grant execute on function listar_usuarios(), crear_usuario(text, text, text, rol_area),
  cambiar_area_usuario(uuid, rol_area), activar_usuario(uuid, boolean, text), restablecer_clave(uuid, text),
  cambiar_mi_clave(text, text), bitacora_usuarios()
  to authenticated;
