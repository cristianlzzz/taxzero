-- Documentos de Crédito por grupo y folio de Opera de la cuenta maestra con la devolución.
-- Solo agrega tablas y funciones. Igual que el resto: nada se borra ni se modifica, un
-- archivo o folio nuevo deja visible el anterior y todo queda en la bitácora del grupo.
-- Lo ven Crédito, Impuestos y Administración; solo Crédito sube y registra.

create table documentos_credito (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos (id),
  tipo text not null check (tipo in ('autorizacion', 'conciliacion', 'reporte_opera', 'extraordinario')),
  descripcion text check (length(descripcion) <= 500),
  ruta text not null unique,
  nombre_archivo text not null check (length(nombre_archivo) between 1 and 200),
  mime text not null,
  bytes integer not null check (bytes > 0),
  subido_por uuid not null references perfiles (id),
  subido_por_nombre text not null,
  subido_en timestamptz not null default now(),
  -- Un documento extraordinario siempre explica qué es.
  check (tipo <> 'extraordinario' or length(trim(coalesce(descripcion, ''))) >= 3)
);
create index documentos_credito_idx on documentos_credito (grupo_id, tipo, subido_en);

create table folios_maestra_grupo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos (id),
  folio text not null check (length(trim(folio)) between 1 and 60),
  nota text check (length(nota) <= 500),
  registrado_por uuid not null references perfiles (id),
  registrado_por_nombre text not null,
  ts timestamptz not null default now()
);
create index folios_maestra_idx on folios_maestra_grupo (grupo_id, ts);

create trigger doccredito_no_borrar before delete on documentos_credito for each row execute function no_borrar();
create trigger doccredito_no_modificar before update on documentos_credito for each row execute function no_modificar();
create trigger doccredito_no_truncar before truncate on documentos_credito execute function no_borrar();
create trigger maestra_no_borrar before delete on folios_maestra_grupo for each row execute function no_borrar();
create trigger maestra_no_modificar before update on folios_maestra_grupo for each row execute function no_modificar();
create trigger maestra_no_truncar before truncate on folios_maestra_grupo execute function no_borrar();

alter table documentos_credito enable row level security;
alter table folios_maestra_grupo enable row level security;
revoke all on documentos_credito, folios_maestra_grupo from anon;
revoke insert, update, delete, truncate on documentos_credito, folios_maestra_grupo from authenticated;
grant select on documentos_credito, folios_maestra_grupo to authenticated;
create policy doccredito_ver on documentos_credito for select to authenticated
  using (rol_actual() in ('admin', 'credito', 'impuestos'));
create policy maestra_ver on folios_maestra_grupo for select to authenticated
  using (rol_actual() in ('admin', 'credito', 'impuestos'));

create function etiqueta_doc_credito(t text) returns text
language sql immutable set search_path = public as $$
  select case t
    when 'autorizacion' then 'autorización de la devolución'
    when 'conciliacion' then 'cálculo o conciliación'
    when 'reporte_opera' then 'reporte de Opera con el ajuste'
    when 'extraordinario' then 'documento extraordinario'
  end
$$;

-- ¿Puede este usuario guardar un archivo en la carpeta de Crédito de este grupo?
create function puede_subir_doc_credito(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles p
    where p.id = auth.uid() and p.activo and p.rol = 'credito'
      and split_part(p_ruta, '/', 1) = 'cred'
      and exists (select 1 from grupos g where g.id::text = split_part(p_ruta, '/', 2))
  )
$$;

create function registrar_doc_credito(
  p_grupo uuid, p_tipo text, p_descripcion text, p_ruta text, p_nombre text, p_mime text, p_bytes integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare p perfiles; d_id uuid; descr text := nullif(trim(coalesce(p_descripcion, '')), '');
begin
  p := exigir_rol('credito');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if p_tipo not in ('autorizacion', 'conciliacion', 'reporte_opera', 'extraordinario') then
    raise exception 'Tipo de documento inválido.' using errcode = 'P0001';
  end if;
  if p_tipo = 'extraordinario' and length(coalesce(descr, '')) < 3 then
    raise exception 'Describe qué es el documento extraordinario.' using errcode = 'P0001';
  end if;
  if split_part(p_ruta, '/', 1) <> 'cred' or split_part(p_ruta, '/', 2) <> p_grupo::text then
    raise exception 'Ruta de documento inválida.' using errcode = 'P0001';
  end if;
  insert into documentos_credito (grupo_id, tipo, descripcion, ruta, nombre_archivo, mime, bytes, subido_por, subido_por_nombre)
  values (p_grupo, p_tipo, left(descr, 500), p_ruta, left(trim(p_nombre), 200), p_mime, p_bytes, p.id, p.nombre)
  returning id into d_id;
  perform anotar(p, null, p_grupo, 'Subió ' || etiqueta_doc_credito(p_tipo) || ': ' || left(trim(p_nombre), 200), descr);
  return d_id;
end $$;

create function registrar_folio_maestra(p_grupo uuid, p_folio text, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; f text := trim(coalesce(p_folio, '')); n text := nullif(trim(coalesce(p_nota, '')), '');
begin
  p := exigir_rol('credito');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if f = '' then raise exception 'Escribe el folio de Opera.' using errcode = 'P0001'; end if;
  insert into folios_maestra_grupo (grupo_id, folio, nota, registrado_por, registrado_por_nombre)
  values (p_grupo, upper(f), left(n, 500), p.id, p.nombre);
  perform anotar(p, null, p_grupo, 'Registró folio de Opera de la cuenta maestra con la devolución: ' || upper(f), n);
end $$;

revoke execute on function etiqueta_doc_credito(text), puede_subir_doc_credito(text),
  registrar_doc_credito(uuid, text, text, text, text, text, integer), registrar_folio_maestra(uuid, text, text)
  from public, anon;
grant execute on function puede_subir_doc_credito(text),
  registrar_doc_credito(uuid, text, text, text, text, text, integer), registrar_folio_maestra(uuid, text, text)
  to authenticated;
