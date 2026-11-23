-- Etapa 2: revisiones de Grupos, Crédito e Impuestos; monto de devolución y folio de
-- factura por grupo. Igual que antes: todo cambio pasa por una función que valida el
-- rol y deja registro; nada se borra (un monto o folio nuevo deja visible el anterior).

create table montos_grupo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos (id),
  valor text not null check (length(trim(valor)) between 1 and 40),
  nota text not null check (length(trim(nota)) between 3 and 500),
  registrado_por uuid not null references perfiles (id),
  registrado_por_nombre text not null,
  ts timestamptz not null default now()
);
create index montos_grupo_idx on montos_grupo (grupo_id, ts);

create table facturas_grupo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos (id),
  folio text not null check (length(trim(folio)) between 1 and 60),
  registrado_por uuid not null references perfiles (id),
  registrado_por_nombre text not null,
  ts timestamptz not null default now()
);
create index facturas_grupo_idx on facturas_grupo (grupo_id, ts);

create trigger montos_no_borrar before delete on montos_grupo for each row execute function no_borrar();
create trigger montos_no_modificar before update on montos_grupo for each row execute function no_modificar();
create trigger facturas_no_borrar before delete on facturas_grupo for each row execute function no_borrar();
create trigger facturas_no_modificar before update on facturas_grupo for each row execute function no_modificar();

alter table montos_grupo enable row level security;
alter table facturas_grupo enable row level security;
revoke all on montos_grupo, facturas_grupo from anon;
revoke insert, update, delete, truncate on montos_grupo, facturas_grupo from authenticated;
create policy montos_pc on montos_grupo for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'credito', 'impuestos'));
create policy facturas_pc on facturas_grupo for select to authenticated
  using (rol_actual() in ('admin', 'grupos', 'credito', 'impuestos'));

-- Una sola función para todas las decisiones sobre un expediente.
-- p_estado: el estado que la persona estaba viendo; si otra persona ya lo cambió, se
-- rechaza para no actuar sobre información vieja.
create function revisar_expediente(
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

create function registrar_monto(p_grupo uuid, p_valor text, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; v text := trim(coalesce(p_valor, ''));
begin
  p := exigir_rol('credito');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if v = '' then raise exception 'Escribe el monto.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_nota, ''))) < 3 then
    raise exception 'Escribe quién autorizó y la referencia.' using errcode = 'P0001';
  end if;
  if v !~* '^usd' then v := 'USD ' || v; end if;
  insert into montos_grupo (grupo_id, valor, nota, registrado_por, registrado_por_nombre)
  values (p_grupo, v, trim(p_nota), p.id, p.nombre);
  perform anotar(p, null, p_grupo, 'Registró monto final de devolución: ' || v, trim(p_nota));
end $$;

create function registrar_factura(p_grupo uuid, p_folio text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; f text := trim(coalesce(p_folio, ''));
begin
  p := exigir_rol('impuestos');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if f = '' then raise exception 'Escribe el folio.' using errcode = 'P0001'; end if;
  insert into facturas_grupo (grupo_id, folio, registrado_por, registrado_por_nombre)
  values (p_grupo, f, p.id, p.nombre);
  perform anotar(p, null, p_grupo, 'Registró folio de factura: ' || f);
end $$;

revoke execute on function revisar_expediente(uuid, text, estado_exp, text, tipo_doc[]),
  registrar_monto(uuid, text, text), registrar_factura(uuid, text) from public, anon;
grant execute on function revisar_expediente(uuid, text, estado_exp, text, tipo_doc[]),
  registrar_monto(uuid, text, text), registrar_factura(uuid, text) to authenticated;
