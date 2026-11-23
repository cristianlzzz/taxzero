-- Taxzero · esquema inicial (etapa 1)
-- Reglas: nada se borra, la bitácora no se edita, cada cambio de estado pasa por
-- una función que valida el rol y deja registro. Las tablas no aceptan escrituras
-- directas desde la app: solo lectura con RLS y escritura por funciones.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- Tipos
create type rol_area as enum ('admin', 'grupos', 'frontdesk', 'ipad', 'credito', 'impuestos');
create type estado_exp as enum (
  'pendiente', 'incompleta', 'rev_grupos', 'val_credito', 'rev_impuestos',
  'cerrado', 'dev_grupos', 'dev_credito', 'no_aplica'
);
create type tipo_doc as enum ('pasaporte', 'regcard', 'pago', 'fmm');
create type tipo_fmm as enum ('fmm', 'sello', 'qr');

-- ---------------------------------------------------------------- Tablas
create table perfiles (
  id uuid primary key references auth.users (id),
  nombre text not null check (length(trim(nombre)) between 2 and 120),
  rol rol_area not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table grupos (
  id uuid primary key default gen_random_uuid(),
  folio integer generated always as identity (start with 101) unique,
  nombre text not null check (length(trim(nombre)) between 2 and 200),
  empresa text not null check (length(trim(empresa)) between 1 and 200),
  contacto text check (length(contacto) <= 200),
  codigo_opera text check (length(codigo_opera) <= 60),
  llegada date not null,
  salida date not null,
  estimados integer check (estimados between 1 and 5000),
  creado_por uuid not null references perfiles (id),
  creado_en timestamptz not null default now(),
  check (salida >= llegada)
);

create table expedientes (
  id uuid primary key default gen_random_uuid(),
  folio integer generated always as identity (start with 1001) unique,
  grupo_id uuid not null references grupos (id),
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  apellidos text not null check (length(trim(apellidos)) between 1 and 120),
  nacionalidad_codigo char(3) not null check (nacionalidad_codigo ~ '^[A-Z]{3}$'),
  nacionalidad text not null check (length(nacionalidad) between 2 and 80),
  pasaporte text check (length(pasaporte) <= 30),
  estado estado_exp not null default 'pendiente',
  recapturar tipo_doc[] not null default '{}',
  creado_por uuid not null references perfiles (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index expedientes_grupo_idx on expedientes (grupo_id, estado);

-- Código de captura: no lleva datos personales, sirve una vez y vence a los 15 min.
create table codigos_captura (
  codigo text primary key check (codigo ~ '^TZ-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  expediente_id uuid not null references expedientes (id),
  creado_por uuid not null references perfiles (id),
  creado_en timestamptz not null default now(),
  vence_en timestamptz not null,
  usado_en timestamptz,
  usado_por uuid references perfiles (id),
  pasos tipo_doc[],
  finalizado_en timestamptz
);
create index codigos_exp_idx on codigos_captura (expediente_id, creado_en desc);
create index codigos_abiertos_idx on codigos_captura (vence_en) where usado_en is not null and finalizado_en is null;

-- Cada foto es una versión; las anteriores se conservan.
create table documentos (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references expedientes (id),
  tipo tipo_doc not null,
  version integer not null check (version >= 1),
  ruta text not null unique,
  fmm_tipo tipo_fmm,
  mime text not null default 'image/jpeg',
  bytes integer not null check (bytes > 0),
  ancho integer,
  alto integer,
  nitidez numeric,
  codigo text references codigos_captura (codigo),
  capturado_por uuid not null references perfiles (id),
  capturado_en timestamptz not null default now(),
  unique (expediente_id, tipo, version)
);

create table bitacora (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  expediente_id uuid references expedientes (id),
  grupo_id uuid references grupos (id),
  usuario_id uuid references perfiles (id),
  usuario_nombre text not null,
  rol text not null,
  accion text not null,
  motivo text
);
create index bitacora_exp_idx on bitacora (expediente_id, ts);
create index bitacora_grupo_idx on bitacora (grupo_id, ts);

-- ---------------------------------------------------------------- Nada se borra
create function no_borrar() returns trigger language plpgsql as $$
begin
  raise exception 'En Taxzero no se borra información (%).', tg_table_name using errcode = 'P0001';
end $$;

create function no_modificar() returns trigger language plpgsql as $$
begin
  raise exception 'Este registro no se puede modificar (%).', tg_table_name using errcode = 'P0001';
end $$;

create trigger perfiles_no_borrar before delete on perfiles for each row execute function no_borrar();
create trigger grupos_no_borrar before delete on grupos for each row execute function no_borrar();
create trigger expedientes_no_borrar before delete on expedientes for each row execute function no_borrar();
create trigger codigos_no_borrar before delete on codigos_captura for each row execute function no_borrar();
create trigger documentos_no_borrar before delete on documentos for each row execute function no_borrar();
create trigger documentos_no_modificar before update on documentos for each row execute function no_modificar();
create trigger bitacora_no_borrar before delete on bitacora for each row execute function no_borrar();
create trigger bitacora_no_modificar before update on bitacora for each row execute function no_modificar();
create trigger bitacora_no_truncar before truncate on bitacora execute function no_borrar();
create trigger documentos_no_truncar before truncate on documentos execute function no_borrar();

-- ---------------------------------------------------------------- Ayudantes
create function rol_actual() returns rol_area
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create function exigir_rol(variadic permitidos rol_area[]) returns perfiles
language plpgsql stable security definer set search_path = public as $$
declare p perfiles;
begin
  select * into p from perfiles where id = auth.uid() and activo;
  if p.id is null then
    raise exception 'Tu usuario no tiene acceso a Taxzero.' using errcode = '42501';
  end if;
  if not (p.rol = any (permitidos)) then
    raise exception 'Tu área no puede hacer esta acción.' using errcode = '42501';
  end if;
  return p;
end $$;

create function etiqueta_rol(r rol_area) returns text language sql immutable as $$
  select case r
    when 'admin' then 'Administración'
    when 'grupos' then 'Grupos'
    when 'frontdesk' then 'Front Desk'
    when 'ipad' then 'iPad'
    when 'credito' then 'Crédito'
    when 'impuestos' then 'Impuestos'
  end
$$;

create function etiqueta_doc(t tipo_doc) returns text language sql immutable as $$
  select case t
    when 'pasaporte' then 'pasaporte'
    when 'regcard' then 'registration card'
    when 'pago' then 'comprobante de pago'
    when 'fmm' then 'forma migratoria'
  end
$$;

create function anotar(p perfiles, exp_id uuid, grp_id uuid, accion text, motivo text default null)
returns void language sql security definer set search_path = public as $$
  insert into bitacora (expediente_id, grupo_id, usuario_id, usuario_nombre, rol, accion, motivo)
  values (exp_id, grp_id, p.id, p.nombre, etiqueta_rol(p.rol), accion, nullif(trim(motivo), ''))
$$;

create function nuevo_codigo() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := gen_random_bytes(8);
  s text := 'TZ-';
begin
  for i in 0..7 loop
    if i = 4 then s := s || '-'; end if;
    s := s || substr(alfabeto, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return s;
end $$;

-- ---------------------------------------------------------------- Funciones de la app
create function mi_perfil() returns table (id uuid, nombre text, rol rol_area)
language sql stable security definer set search_path = public as $$
  select id, nombre, rol from perfiles where id = auth.uid() and activo
$$;

create function crear_grupo(
  p_nombre text, p_empresa text, p_contacto text, p_codigo_opera text,
  p_llegada date, p_salida date, p_estimados integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare p perfiles; g_id uuid;
begin
  p := exigir_rol('grupos', 'admin');
  insert into grupos (nombre, empresa, contacto, codigo_opera, llegada, salida, estimados, creado_por)
  values (trim(p_nombre), trim(p_empresa), nullif(trim(p_contacto), ''), nullif(upper(trim(p_codigo_opera)), ''),
          p_llegada, p_salida, p_estimados, p.id)
  returning id into g_id;
  perform anotar(p, null, g_id, 'Alta del grupo');
  return g_id;
end $$;

create function alta_huesped(
  p_grupo uuid, p_nombre text, p_apellidos text, p_nac_codigo text, p_nac_nombre text, p_pasaporte text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare p perfiles; e_id uuid;
begin
  p := exigir_rol('frontdesk', 'admin');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  insert into expedientes (grupo_id, nombre, apellidos, nacionalidad_codigo, nacionalidad, pasaporte, creado_por)
  values (p_grupo, trim(p_nombre), trim(p_apellidos), upper(p_nac_codigo), trim(p_nac_nombre),
          nullif(upper(regexp_replace(p_pasaporte, '\s', '', 'g')), ''), p.id)
  returning id into e_id;
  perform anotar(p, e_id, p_grupo, 'Alta del huésped en el grupo');
  return e_id;
end $$;

-- Devuelve el código activo del expediente o crea uno nuevo.
create function generar_codigo(p_expediente uuid)
returns table (codigo text, vence_en timestamptz, nuevo boolean)
language plpgsql security definer set search_path = public as $$
declare p perfiles; e expedientes; c codigos_captura;
begin
  p := exigir_rol('frontdesk', 'admin');
  select * into e from expedientes where id = p_expediente for update;
  if e.id is null then raise exception 'El expediente no existe.' using errcode = 'P0002'; end if;
  if e.estado not in ('pendiente', 'incompleta') then
    raise exception 'Este expediente ya no está en captura.' using errcode = 'P0001';
  end if;
  select * into c from codigos_captura k
    where k.expediente_id = e.id and k.usado_en is null and k.vence_en > now()
    order by k.creado_en desc limit 1;
  if c.codigo is not null then
    return query select c.codigo, c.vence_en, false;
    return;
  end if;
  loop
    begin
      insert into codigos_captura (codigo, expediente_id, creado_por, vence_en)
      values (nuevo_codigo(), e.id, p.id, now() + interval '15 minutes')
      returning * into c;
      exit;
    exception when unique_violation then
      -- colisión improbable: se intenta con otro código
    end;
  end loop;
  perform anotar(p, e.id, e.grupo_id, 'Generó código QR de captura');
  return query select c.codigo, c.vence_en, true;
end $$;

-- Cierra una captura: guarda el resultado y deja el código como finalizado.
create function cerrar_captura(c codigos_captura, p perfiles, por_vencimiento boolean)
returns table (estado estado_exp, faltan tipo_doc[])
language plpgsql security definer set search_path = public as $$
declare
  e expedientes;
  tomados tipo_doc[];
  falt tipo_doc[];
  habia_recaptura boolean;
  nuevo estado_exp;
  lista text;
begin
  select * into e from expedientes where id = c.expediente_id for update;
  select coalesce(array_agg(distinct d.tipo), '{}') into tomados
    from documentos d where d.codigo = c.codigo;
  select coalesce(array_agg(t order by array_position(enum_range(null::tipo_doc), t)), '{}') into falt
    from unnest(enum_range(null::tipo_doc)) t
    where not exists (select 1 from documentos d where d.expediente_id = e.id and d.tipo = t)
       or (t = any (e.recapturar) and not (t = any (tomados)));
  habia_recaptura := cardinality(e.recapturar) > 0;
  nuevo := case when cardinality(falt) > 0 then 'incompleta' else 'rev_grupos' end;
  update expedientes x
     set estado = nuevo,
         recapturar = (select coalesce(array_agg(t), '{}') from unnest(falt) t where t = any (e.recapturar)),
         actualizado_en = now()
   where x.id = e.id;
  update codigos_captura k set finalizado_en = now() where k.codigo = c.codigo;
  select string_agg(etiqueta_doc(t), ', ') into lista from unnest(falt) t;
  if nuevo = 'incompleta' then
    perform anotar(p, e.id, e.grupo_id,
      case when por_vencimiento then 'Captura guardada como incompleta (el código venció)'
           else 'Captura guardada como incompleta' end,
      'Faltó: ' || lista);
  else
    perform anotar(p, e.id, e.grupo_id,
      case when habia_recaptura then 'Recaptura enviada a Grupos' else 'Captura enviada a Grupos' end);
  end if;
  return query select nuevo, falt;
end $$;

-- El iPad escanea el código: se marca usado en ese momento (un solo uso).
create function iniciar_captura(p_codigo text)
returns table (
  expediente_id uuid, folio integer, nombre text, apellidos text, grupo text,
  pasos tipo_doc[], vence_en timestamptz
)
language plpgsql security definer set search_path = public as $$
declare p perfiles; c codigos_captura; e expedientes; pas tipo_doc[];
begin
  p := exigir_rol('ipad');
  select * into c from codigos_captura k where k.codigo = upper(trim(p_codigo)) for update;
  if c.codigo is null then
    raise exception 'CODIGO_NO_EXISTE' using errcode = 'P0001';
  end if;
  if c.usado_en is not null then
    raise exception 'CODIGO_USADO' using errcode = 'P0001';
  end if;
  if c.vence_en <= now() then
    raise exception 'CODIGO_VENCIDO' using errcode = 'P0001';
  end if;
  select * into e from expedientes x where x.id = c.expediente_id for update;
  if e.estado not in ('pendiente', 'incompleta') then
    raise exception 'CODIGO_SIN_CAPTURA' using errcode = 'P0001';
  end if;
  if cardinality(e.recapturar) > 0 then
    pas := e.recapturar;
  elsif e.estado = 'incompleta' then
    select array_agg(t) into pas from unnest(enum_range(null::tipo_doc)) t
     where not exists (select 1 from documentos d where d.expediente_id = e.id and d.tipo = t);
  end if;
  if pas is null or cardinality(pas) = 0 then
    pas := enum_range(null::tipo_doc);
  end if;
  update codigos_captura k set usado_en = now(), usado_por = p.id, pasos = pas where k.codigo = c.codigo;
  perform anotar(p, e.id, e.grupo_id, 'Código QR escaneado en la estación de captura');
  return query
    select e.id, e.folio, e.nombre, e.apellidos, g.nombre, pas, c.vence_en
    from grupos g where g.id = e.grupo_id;
end $$;

-- ¿La estación puede subir una foto a esta carpeta? Se usa en la política de Storage.
create function puede_subir_documento(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from codigos_captura k
    join perfiles p on p.id = auth.uid() and p.activo and p.rol = 'ipad'
    where k.usado_por = auth.uid()
      and k.finalizado_en is null
      and k.vence_en > now() - interval '1 minute'
      and split_part(p_ruta, '/', 1) = 'exp'
      and split_part(p_ruta, '/', 2) = k.expediente_id::text
  )
$$;

create function registrar_documento(
  p_codigo text, p_tipo tipo_doc, p_ruta text, p_fmm_tipo tipo_fmm,
  p_bytes integer, p_ancho integer, p_alto integer, p_nitidez numeric
) returns integer
language plpgsql security definer set search_path = public as $$
declare p perfiles; c codigos_captura; v integer;
begin
  p := exigir_rol('ipad');
  select * into c from codigos_captura k where k.codigo = p_codigo for update;
  if c.codigo is null or c.usado_por is distinct from p.id then
    raise exception 'Esta captura no pertenece a esta estación.' using errcode = '42501';
  end if;
  if c.finalizado_en is not null then
    raise exception 'CAPTURA_CERRADA' using errcode = 'P0001';
  end if;
  -- un minuto de gracia para la foto que se estaba subiendo cuando venció el código
  if c.vence_en <= now() - interval '1 minute' then
    raise exception 'CODIGO_VENCIDO' using errcode = 'P0001';
  end if;
  if not (p_tipo = any (c.pasos)) then
    raise exception 'Ese documento no se pidió en esta captura.' using errcode = 'P0001';
  end if;
  if split_part(p_ruta, '/', 2) <> c.expediente_id::text then
    raise exception 'Ruta de documento inválida.' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v
    from documentos where expediente_id = c.expediente_id and tipo = p_tipo;
  insert into documentos (expediente_id, tipo, version, ruta, fmm_tipo, bytes, ancho, alto, nitidez, codigo, capturado_por)
  values (c.expediente_id, p_tipo, v, p_ruta,
          case when p_tipo = 'fmm' then coalesce(p_fmm_tipo, 'fmm') end,
          p_bytes, p_ancho, p_alto, p_nitidez, c.codigo, p.id);
  return v;
end $$;

create function finalizar_captura(p_codigo text)
returns table (estado estado_exp, faltan tipo_doc[])
language plpgsql security definer set search_path = public as $$
declare p perfiles; c codigos_captura;
begin
  p := exigir_rol('ipad');
  select * into c from codigos_captura k where k.codigo = p_codigo for update;
  if c.codigo is null or c.usado_por is distinct from p.id then
    raise exception 'Esta captura no pertenece a esta estación.' using errcode = '42501';
  end if;
  if c.finalizado_en is not null then
    -- ya se cerró (por ejemplo, venció): se devuelve cómo quedó
    return query
      select x.estado, x.recapturar from expedientes x where x.id = c.expediente_id;
    return;
  end if;
  return query select * from cerrar_captura(c, p, c.vence_en <= now());
end $$;

-- Cierra capturas cuyo código venció sin que la estación enviara. Lo llama el
-- programador de tareas del servidor cada pocos minutos.
create function cerrar_capturas_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare c codigos_captura; p perfiles; n integer := 0;
begin
  for c in
    select * from codigos_captura
     where usado_en is not null and finalizado_en is null and vence_en <= now() - interval '1 minute'
     for update skip locked
  loop
    select * into p from perfiles where id = c.usado_por;
    perform cerrar_captura(c, p, true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- Permisos
alter table perfiles enable row level security;
alter table grupos enable row level security;
alter table expedientes enable row level security;
alter table codigos_captura enable row level security;
alter table documentos enable row level security;
alter table bitacora enable row level security;

-- Solo lectura desde la app; toda escritura va por las funciones de arriba.
revoke insert, update, delete, truncate on perfiles, grupos, expedientes, codigos_captura, documentos, bitacora
  from anon, authenticated;
revoke all on perfiles, grupos, expedientes, codigos_captura, documentos, bitacora from anon;

create policy perfiles_propio on perfiles for select to authenticated
  using (id = auth.uid() or rol_actual() = 'admin');

create policy grupos_pc on grupos for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'frontdesk', 'credito', 'impuestos'));

create policy expedientes_pc on expedientes for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'frontdesk', 'credito', 'impuestos'));

create policy documentos_pc on documentos for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'frontdesk', 'credito', 'impuestos'));

create policy bitacora_pc on bitacora for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'frontdesk', 'credito', 'impuestos'));

create policy codigos_frontdesk on codigos_captura for select to authenticated
  using (rol_actual() in ('admin', 'frontdesk'));

-- Funciones: nadie anónimo, salvo el cierre de capturas vencidas (no recibe datos
-- y solo cierra lo que ya venció).
revoke execute on all functions in schema public from public, anon;
grant execute on function
  mi_perfil(), crear_grupo(text, text, text, text, date, date, integer),
  alta_huesped(uuid, text, text, text, text, text), generar_codigo(uuid),
  iniciar_captura(text), registrar_documento(text, tipo_doc, text, tipo_fmm, integer, integer, integer, numeric),
  finalizar_captura(text), rol_actual(), puede_subir_documento(text)
  to authenticated;
grant execute on function cerrar_capturas_vencidas() to anon, authenticated;
revoke execute on function cerrar_captura(codigos_captura, perfiles, boolean), anotar(perfiles, uuid, uuid, text, text),
  exigir_rol(rol_area[]) from authenticated;

-- ---------------------------------------------------------------- Documentos (Storage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy documentos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.puede_subir_documento(name));

create policy documentos_ver on storage.objects for select to authenticated
  using (bucket_id = 'documentos'
         and public.rol_actual() in ('admin', 'grupos', 'frontdesk', 'credito', 'impuestos'));
-- Sin políticas de update ni delete: una foto guardada no se reemplaza ni se borra.
