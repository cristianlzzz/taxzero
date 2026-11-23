-- Etapa 3: expediente del evento según la guía interna de estímulo fiscal.
-- Por grupo: datos del evento y del organizador, documentos del evento (contrato,
-- agenda, salones, lista de asistentes, etc.), verificación de 10 puntos de Impuestos,
-- semáforo de riesgo y facturas separadas (evento / días personales).
-- Por huésped: vencimiento del pasaporte y gafete o constancia (opcional).
-- Igual que antes: nada se borra; un dato nuevo deja visible el anterior.

create type tipo_evento as enum ('congreso', 'convencion', 'exposicion', 'feria');
create type tipo_doc_grupo as enum ('contrato', 'agenda', 'salones', 'asistentes', 'organizador', 'constancias', 'rooming');
create type nivel_riesgo as enum ('bajo', 'medio', 'alto');

alter table expedientes add column pasaporte_vence date;
alter table facturas_grupo add column tipo text not null default 'evento' check (tipo in ('evento', 'personal'));

create table evento_grupo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos (id),
  tipo tipo_evento not null,
  organizador text not null check (length(trim(organizador)) between 2 and 200),
  pais_codigo char(3) check (pais_codigo ~ '^[A-Z]{3}$'),
  pais text check (length(pais) <= 80),
  id_fiscal text check (length(id_fiscal) <= 60),
  registrado_por uuid not null references perfiles (id),
  registrado_por_nombre text not null,
  ts timestamptz not null default now()
);
create index evento_grupo_idx on evento_grupo (grupo_id, ts);

create table documentos_grupo (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos (id),
  tipo tipo_doc_grupo not null,
  ruta text not null unique,
  nombre_archivo text not null check (length(nombre_archivo) between 1 and 200),
  mime text not null,
  bytes integer not null check (bytes > 0),
  subido_por uuid not null references perfiles (id),
  subido_por_nombre text not null,
  subido_en timestamptz not null default now()
);
create index documentos_grupo_idx on documentos_grupo (grupo_id, tipo, subido_en);

create table verificacion_grupo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos (id),
  punto smallint not null check (punto between 1 and 10),
  marcado boolean not null,
  registrado_por uuid not null references perfiles (id),
  registrado_por_nombre text not null,
  ts timestamptz not null default now()
);
create index verificacion_grupo_idx on verificacion_grupo (grupo_id, ts);

create table riesgo_grupo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos (id),
  nivel nivel_riesgo not null,
  nota text not null check (length(trim(nota)) between 3 and 500),
  registrado_por uuid not null references perfiles (id),
  registrado_por_nombre text not null,
  ts timestamptz not null default now()
);
create index riesgo_grupo_idx on riesgo_grupo (grupo_id, ts);

create trigger evento_no_borrar before delete on evento_grupo for each row execute function no_borrar();
create trigger evento_no_modificar before update on evento_grupo for each row execute function no_modificar();
create trigger docgrupo_no_borrar before delete on documentos_grupo for each row execute function no_borrar();
create trigger docgrupo_no_modificar before update on documentos_grupo for each row execute function no_modificar();
create trigger verif_no_borrar before delete on verificacion_grupo for each row execute function no_borrar();
create trigger verif_no_modificar before update on verificacion_grupo for each row execute function no_modificar();
create trigger riesgo_no_borrar before delete on riesgo_grupo for each row execute function no_borrar();
create trigger riesgo_no_modificar before update on riesgo_grupo for each row execute function no_modificar();

alter table evento_grupo enable row level security;
alter table documentos_grupo enable row level security;
alter table verificacion_grupo enable row level security;
alter table riesgo_grupo enable row level security;
revoke all on evento_grupo, documentos_grupo, verificacion_grupo, riesgo_grupo from anon;
revoke insert, update, delete, truncate on evento_grupo, documentos_grupo, verificacion_grupo, riesgo_grupo from authenticated;
create policy evento_pc on evento_grupo for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'frontdesk', 'credito', 'impuestos'));
create policy docgrupo_pc on documentos_grupo for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'credito', 'impuestos'));
create policy verif_pc on verificacion_grupo for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'credito', 'impuestos'));
create policy riesgo_pc on riesgo_grupo for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'credito', 'impuestos'));

-- ---------------------------------------------------------------- etiquetas
create or replace function etiqueta_doc(t tipo_doc) returns text
language plpgsql immutable set search_path = public as $$
begin
  return case t::text
    when 'pasaporte' then 'pasaporte'
    when 'regcard' then 'registration card'
    when 'pago' then 'comprobante de pago'
    when 'fmm' then 'forma migratoria'
    when 'constancia' then 'gafete o constancia'
  end;
end $$;

create function etiqueta_doc_grupo(t tipo_doc_grupo) returns text
language sql immutable set search_path = public as $$
  select case t
    when 'contrato' then 'contrato del evento'
    when 'agenda' then 'agenda o programa oficial'
    when 'salones' then 'evidencia de uso de salones'
    when 'asistentes' then 'lista oficial de asistentes'
    when 'organizador' then 'identificación fiscal del organizador'
    when 'constancias' then 'gafetes o constancias de participación'
    when 'rooming' then 'rooming list'
  end
$$;

create function etiqueta_evento(t tipo_evento) returns text
language sql immutable set search_path = public as $$
  select case t when 'congreso' then 'Congreso' when 'convencion' then 'Convención'
    when 'exposicion' then 'Exposición' when 'feria' then 'Feria' end
$$;

-- Documentos que el iPad siempre pide. El gafete o constancia es opcional.
create function docs_requeridos() returns tipo_doc[]
language sql immutable set search_path = public as $$
  select array['pasaporte', 'regcard', 'pago', 'fmm']::tipo_doc[]
$$;

-- ---------------------------------------------------------------- captura (ajustes)
create or replace function cerrar_captura(c codigos_captura, p perfiles, por_vencimiento boolean)
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
    where (t = any (docs_requeridos())
           and not exists (select 1 from documentos d where d.expediente_id = e.id and d.tipo = t))
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

-- Devuelve además los pasos opcionales (gafete o constancia) que el iPad puede ofrecer.
drop function iniciar_captura(text);
create function iniciar_captura(p_codigo text)
returns table (
  expediente_id uuid, folio integer, nombre text, apellidos text, grupo text,
  pasos tipo_doc[], vence_en timestamptz, opcionales tipo_doc[]
)
language plpgsql security definer set search_path = public as $$
declare p perfiles; c codigos_captura; e expedientes; pas tipo_doc[]; opc tipo_doc[] := '{}';
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
    select array_agg(t) into pas from unnest(docs_requeridos()) t
     where not exists (select 1 from documentos d where d.expediente_id = e.id and d.tipo = t);
  end if;
  if pas is null or cardinality(pas) = 0 then
    pas := docs_requeridos();
  end if;
  if not ('constancia'::tipo_doc = any (pas))
     and not exists (select 1 from documentos d where d.expediente_id = e.id and d.tipo = 'constancia') then
    opc := array['constancia']::tipo_doc[];
  end if;
  update codigos_captura k set usado_en = now(), usado_por = p.id, pasos = pas where k.codigo = c.codigo;
  perform anotar(p, e.id, e.grupo_id, 'Código QR escaneado en la estación de captura');
  return query
    select e.id, e.folio, e.nombre, e.apellidos, g.nombre, pas, c.vence_en, opc
    from grupos g where g.id = e.grupo_id;
end $$;
revoke execute on function iniciar_captura(text) from public, anon;
grant execute on function iniciar_captura(text) to authenticated;

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

-- ---------------------------------------------------------------- huésped: vencimiento del pasaporte
create function registrar_vencimiento(p_expediente uuid, p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; e expedientes;
begin
  p := exigir_rol('frontdesk', 'grupos', 'admin');
  select * into e from expedientes where id = p_expediente for update;
  if e.id is null then raise exception 'El expediente no existe.' using errcode = 'P0002'; end if;
  if e.estado not in ('pendiente', 'incompleta', 'rev_grupos', 'dev_grupos') then
    raise exception 'Este expediente ya pasó la revisión de Grupos; no se puede cambiar el pasaporte.' using errcode = 'P0001';
  end if;
  if p_fecha is null or p_fecha < date '2000-01-01' or p_fecha > date '2100-01-01' then
    raise exception 'Escribe una fecha de vencimiento válida.' using errcode = 'P0001';
  end if;
  update expedientes set pasaporte_vence = p_fecha, actualizado_en = now() where id = e.id;
  perform anotar(p, e.id, e.grupo_id,
    case when e.pasaporte_vence is null then 'Registró vencimiento del pasaporte: '
         else 'Cambió vencimiento del pasaporte (antes ' || to_char(e.pasaporte_vence, 'DD/MM/YYYY') || '): ' end
    || to_char(p_fecha, 'DD/MM/YYYY'));
end $$;

-- Aprobar exige el vencimiento del pasaporte registrado. Lo demás queda igual que en la etapa 2.
create or replace function revisar_expediente(
  p_expediente uuid, p_accion text, p_estado estado_exp, p_motivo text default null, p_docs tipo_doc[] default null
) returns estado_exp
language plpgsql security definer set search_path = public as $$
declare
  p perfiles;
  e expedientes;
  nuevo estado_exp;
  texto text;
  motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  desde estado_exp[];
  roles rol_area[];
  requiere_motivo boolean := false;
begin
  case p_accion
    when 'aprobar' then roles := '{grupos}'; desde := '{rev_grupos,dev_grupos}'; nuevo := 'val_credito'; texto := 'Aprobado y enviado a Crédito';
    when 'recaptura' then roles := '{grupos}'; desde := '{rev_grupos,dev_grupos}'; nuevo := 'incompleta'; requiere_motivo := true;
    when 'no_aplica' then roles := '{grupos}'; desde := '{pendiente,incompleta,rev_grupos,dev_grupos}'; nuevo := 'no_aplica'; texto := 'Marcado como No aplica'; requiere_motivo := true;
    when 'validar' then roles := '{credito}'; desde := '{val_credito,dev_credito}'; nuevo := 'rev_impuestos'; texto := 'Validado y enviado a Impuestos';
    when 'devolver_grupos' then roles := '{credito}'; desde := '{val_credito,dev_credito}'; nuevo := 'dev_grupos'; texto := 'Devuelto a Grupos'; requiere_motivo := true;
    when 'cerrar' then roles := '{impuestos}'; desde := '{rev_impuestos}'; nuevo := 'cerrado'; texto := 'Expediente cerrado';
    when 'devolver_credito' then roles := '{impuestos}'; desde := '{rev_impuestos}'; nuevo := 'dev_credito'; texto := 'Devuelto a Crédito'; requiere_motivo := true;
    when 'reabrir' then roles := '{impuestos}'; desde := '{cerrado}'; nuevo := 'rev_impuestos'; texto := 'Reabierto por auditoría'; requiere_motivo := true;
    else raise exception 'Acción no válida.' using errcode = 'P0001';
  end case;

  p := exigir_rol(variadic roles);
  select * into e from expedientes where id = p_expediente for update;
  if e.id is null then raise exception 'El expediente no existe.' using errcode = 'P0002'; end if;
  if e.estado is distinct from p_estado then
    raise exception 'Otra persona ya cambió este expediente. Se actualizó la pantalla para que veas cómo quedó.' using errcode = 'P0001';
  end if;
  if not (e.estado = any (desde)) then
    raise exception 'Esta acción no aplica en el estado actual del expediente.' using errcode = 'P0001';
  end if;
  if requiere_motivo and (motivo is null or length(motivo) < 3) then
    raise exception 'Escribe el motivo.' using errcode = 'P0001';
  end if;
  if length(motivo) > 500 then
    raise exception 'El motivo es demasiado largo.' using errcode = 'P0001';
  end if;
  if p_accion = 'aprobar' and e.pasaporte_vence is null then
    raise exception 'Registra la fecha de vencimiento del pasaporte antes de aprobar.' using errcode = 'P0001';
  end if;

  if p_accion = 'recaptura' then
    if p_docs is null or cardinality(p_docs) = 0 then
      raise exception 'Elige qué documentos hay que volver a capturar.' using errcode = 'P0001';
    end if;
    select array_agg(t order by array_position(enum_range(null::tipo_doc), t)) into p_docs
      from (select distinct unnest(p_docs) t) x;
    select 'Pidió recapturar: ' || string_agg(etiqueta_doc(t), ', ') into texto from unnest(p_docs) t;
    update expedientes set estado = nuevo, recapturar = p_docs, actualizado_en = now() where id = e.id;
  else
    update expedientes set estado = nuevo, actualizado_en = now() where id = e.id;
  end if;

  perform anotar(p, e.id, e.grupo_id, texto, motivo);
  return nuevo;
end $$;

-- ---------------------------------------------------------------- grupo: evento y organizador
create function registrar_evento(
  p_grupo uuid, p_tipo tipo_evento, p_organizador text, p_pais_codigo text, p_pais text, p_id_fiscal text
) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; org text := trim(coalesce(p_organizador, ''));
begin
  p := exigir_rol('grupos', 'admin');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if p_tipo is null then raise exception 'Elige el tipo de evento.' using errcode = 'P0001'; end if;
  if length(org) < 2 then raise exception 'Escribe el nombre del organizador.' using errcode = 'P0001'; end if;
  insert into evento_grupo (grupo_id, tipo, organizador, pais_codigo, pais, id_fiscal, registrado_por, registrado_por_nombre)
  values (p_grupo, p_tipo, org, nullif(upper(trim(coalesce(p_pais_codigo, ''))), ''), nullif(trim(coalesce(p_pais, '')), ''),
          nullif(trim(coalesce(p_id_fiscal, '')), ''), p.id, p.nombre);
  perform anotar(p, null, p_grupo, 'Registró datos del evento: ' || etiqueta_evento(p_tipo) || ' · organizador ' || org);
end $$;

-- ¿Grupos puede subir un archivo a la carpeta de este grupo? Se usa en la política de Storage.
create function puede_subir_doc_grupo(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles p
    where p.id = auth.uid() and p.activo and p.rol in ('grupos', 'admin')
      and split_part(p_ruta, '/', 1) = 'grp'
      and exists (select 1 from grupos g where g.id::text = split_part(p_ruta, '/', 2))
  )
$$;

create function registrar_doc_grupo(
  p_grupo uuid, p_tipo tipo_doc_grupo, p_ruta text, p_nombre text, p_mime text, p_bytes integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare p perfiles; d_id uuid;
begin
  p := exigir_rol('grupos', 'admin');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if split_part(p_ruta, '/', 1) <> 'grp' or split_part(p_ruta, '/', 2) <> p_grupo::text then
    raise exception 'Ruta de documento inválida.' using errcode = 'P0001';
  end if;
  insert into documentos_grupo (grupo_id, tipo, ruta, nombre_archivo, mime, bytes, subido_por, subido_por_nombre)
  values (p_grupo, p_tipo, p_ruta, left(trim(p_nombre), 200), p_mime, p_bytes, p.id, p.nombre)
  returning id into d_id;
  perform anotar(p, null, p_grupo, 'Subió ' || etiqueta_doc_grupo(p_tipo) || ': ' || left(trim(p_nombre), 200));
  return d_id;
end $$;

-- ---------------------------------------------------------------- grupo: Impuestos
create function marcar_verificacion(p_grupo uuid, p_punto integer, p_marcado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles;
begin
  p := exigir_rol('impuestos');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if p_punto is null or p_punto not between 1 and 10 then
    raise exception 'Punto de verificación inválido.' using errcode = 'P0001';
  end if;
  insert into verificacion_grupo (grupo_id, punto, marcado, registrado_por, registrado_por_nombre)
  values (p_grupo, p_punto, coalesce(p_marcado, false), p.id, p.nombre);
  perform anotar(p, null, p_grupo,
    case when p_marcado then 'Marcó el punto ' else 'Desmarcó el punto ' end || p_punto || ' de la verificación del grupo');
end $$;

create function registrar_riesgo(p_grupo uuid, p_nivel nivel_riesgo, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; n text := trim(coalesce(p_nota, ''));
begin
  p := exigir_rol('impuestos');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if p_nivel is null then raise exception 'Elige el nivel de riesgo.' using errcode = 'P0001'; end if;
  if length(n) < 3 then raise exception 'Escribe por qué elegiste ese nivel.' using errcode = 'P0001'; end if;
  insert into riesgo_grupo (grupo_id, nivel, nota, registrado_por, registrado_por_nombre)
  values (p_grupo, p_nivel, n, p.id, p.nombre);
  perform anotar(p, null, p_grupo,
    'Registró riesgo ' || case p_nivel when 'bajo' then 'bajo (procede)' when 'medio' then 'medio (cuestionable)' else 'alto (no procede)' end, n);
end $$;

create function registrar_factura_tipo(p_grupo uuid, p_folio text, p_tipo text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; f text := trim(coalesce(p_folio, ''));
begin
  p := exigir_rol('impuestos');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if f = '' then raise exception 'Escribe el folio.' using errcode = 'P0001'; end if;
  if p_tipo not in ('evento', 'personal') then
    raise exception 'Elige si la factura es del evento o de días personales.' using errcode = 'P0001';
  end if;
  insert into facturas_grupo (grupo_id, folio, tipo, registrado_por, registrado_por_nombre)
  values (p_grupo, f, p_tipo, p.id, p.nombre);
  perform anotar(p, null, p_grupo,
    'Registró folio de factura ' || case p_tipo when 'evento' then 'del evento' else 'de días personales' end || ': ' || f);
end $$;

-- ---------------------------------------------------------------- permisos
revoke execute on function registrar_vencimiento(uuid, date),
  registrar_evento(uuid, tipo_evento, text, text, text, text),
  registrar_doc_grupo(uuid, tipo_doc_grupo, text, text, text, integer),
  marcar_verificacion(uuid, integer, boolean), registrar_riesgo(uuid, nivel_riesgo, text),
  registrar_factura_tipo(uuid, text, text), puede_subir_doc_grupo(text),
  docs_requeridos(), etiqueta_doc_grupo(tipo_doc_grupo), etiqueta_evento(tipo_evento)
  from public, anon;
grant execute on function registrar_vencimiento(uuid, date),
  registrar_evento(uuid, tipo_evento, text, text, text, text),
  registrar_doc_grupo(uuid, tipo_doc_grupo, text, text, text, integer),
  marcar_verificacion(uuid, integer, boolean), registrar_riesgo(uuid, nivel_riesgo, text),
  registrar_factura_tipo(uuid, text, text), puede_subir_doc_grupo(text)
  to authenticated;

-- ---------------------------------------------------------------- Storage
-- Los documentos del evento llegan en PDF, foto o Excel (rooming list).
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']
 where id = 'documentos';

create policy documentos_grupo_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.puede_subir_doc_grupo(name));
