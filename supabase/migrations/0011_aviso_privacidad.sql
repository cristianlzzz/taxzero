-- Aviso de privacidad (LFPDPPP).
-- 1) Cada usuario acepta el aviso y el compromiso de confidencialidad al entrar por primera
--    vez y cada vez que cambie la versión del aviso.
-- 2) En el iPad, el huésped acepta el aviso antes de que se tome cualquier foto. Sin esa
--    aceptación la estación no puede guardar documentos.
-- Las aceptaciones no se borran ni se modifican.

create table aceptaciones_aviso (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references perfiles (id),
  version text not null check (length(version) between 1 and 40),
  aceptado_en timestamptz not null default now(),
  unique (usuario_id, version)
);
alter table aceptaciones_aviso enable row level security;
create trigger aceptaciones_no_borrar before delete on aceptaciones_aviso for each row execute function no_borrar();
create trigger aceptaciones_no_modificar before update on aceptaciones_aviso for each row execute function no_modificar();
create trigger aceptaciones_no_truncar before truncate on aceptaciones_aviso execute function no_borrar();

alter table codigos_captura add column aviso_aceptado_en timestamptz;
alter table codigos_captura add column aviso_version text check (length(aviso_version) <= 40);

-- Perfil de la sesión con la última versión del aviso que aceptó el usuario.
create function mi_sesion()
returns table (id uuid, nombre text, rol rol_area, aviso_version text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.rol,
         (select a.version from aceptaciones_aviso a where a.usuario_id = p.id order by a.aceptado_en desc limit 1)
  from perfiles p where p.id = auth.uid() and p.activo
$$;

create function aceptar_aviso(p_version text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; v text := trim(coalesce(p_version, ''));
begin
  select * into p from perfiles where id = auth.uid() and activo;
  if p.id is null then raise exception 'Tu usuario no tiene acceso a Taxzero.' using errcode = '42501'; end if;
  if v = '' or length(v) > 40 then raise exception 'Versión del aviso inválida.' using errcode = 'P0001'; end if;
  insert into aceptaciones_aviso (usuario_id, version) values (p.id, v) on conflict do nothing;
  if found then
    perform anotar_usuario(p, p.id, 'Aceptó el aviso de privacidad y el compromiso de confidencialidad (versión ' || v || ')');
  end if;
end $$;

-- El huésped acepta (o no) el aviso en la estación, antes de las fotos.
create function aviso_huesped(p_codigo text, p_acepta boolean, p_version text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; c codigos_captura; e expedientes; v text := trim(coalesce(p_version, ''));
begin
  p := exigir_rol('ipad');
  select * into c from codigos_captura k where k.codigo = p_codigo for update;
  if c.codigo is null or c.usado_por is distinct from p.id then
    raise exception 'Esta captura no pertenece a esta estación.' using errcode = '42501';
  end if;
  if c.finalizado_en is not null then raise exception 'CAPTURA_CERRADA' using errcode = 'P0001'; end if;
  if v = '' or length(v) > 40 then raise exception 'Versión del aviso inválida.' using errcode = 'P0001'; end if;
  select * into e from expedientes where id = c.expediente_id;
  if p_acepta then
    if c.aviso_aceptado_en is not null then return; end if;
    update codigos_captura k set aviso_aceptado_en = now(), aviso_version = v where k.codigo = c.codigo;
    perform anotar(p, e.id, e.grupo_id, 'El huésped aceptó el aviso de privacidad en la estación de captura (versión ' || v || ')');
  else
    perform anotar(p, e.id, e.grupo_id, 'El huésped no aceptó el aviso de privacidad; no se tomaron fotos (versión ' || v || ')');
  end if;
end $$;

-- La estación solo puede subir fotos si el huésped ya aceptó el aviso en esta captura.
create or replace function puede_subir_documento(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from codigos_captura k
    join perfiles p on p.id = auth.uid() and p.activo and p.rol = 'ipad'
    where k.usado_por = auth.uid()
      and k.finalizado_en is null
      and k.aviso_aceptado_en is not null
      and k.vence_en > now() - interval '1 minute'
      and split_part(p_ruta, '/', 1) = 'exp'
      and split_part(p_ruta, '/', 2) = k.expediente_id::text
  )
$$;

create or replace function registrar_documento(
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
  if c.aviso_aceptado_en is null then
    raise exception 'AVISO_PENDIENTE' using errcode = 'P0001';
  end if;
  if c.vence_en <= now() - interval '1 minute' then
    raise exception 'CODIGO_VENCIDO' using errcode = 'P0001';
  end if;
  -- El gafete o constancia siempre se puede agregar (es opcional).
  if not (p_tipo = any (c.pasos)) and p_tipo <> 'constancia' then
    raise exception 'Ese documento no se pidió en esta captura.' using errcode = 'P0001';
  end if;
  if split_part(p_ruta, '/', 2) <> c.expediente_id::text then
    raise exception 'Ruta de documento inválida.' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v
    from documentos where expediente_id = c.expediente_id and tipo = p_tipo;
  insert into documentos (expediente_id, tipo, version, ruta, fmm_tipo, bytes, ancho, alto, nitidez, codigo,
                          capturado_por, capturado_por_nombre)
  values (c.expediente_id, p_tipo, v, p_ruta,
          case when p_tipo = 'fmm' then coalesce(p_fmm_tipo, 'fmm') end,
          p_bytes, p_ancho, p_alto, p_nitidez, c.codigo, p.id, p.nombre);
  return v;
end $$;

revoke execute on function mi_sesion(), aceptar_aviso(text), aviso_huesped(text, boolean, text) from public, anon;
grant execute on function mi_sesion(), aceptar_aviso(text), aviso_huesped(text, boolean, text) to authenticated;
