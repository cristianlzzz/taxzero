-- Aviso de calidad de fotos en el iPad: la estación revisa cada foto (borrosa, oscura,
-- con reflejo o cortada) antes de guardarla. Si Front Desk decide guardarla de todos
-- modos, se guarda qué detectó y el motivo, y queda anotado en la bitácora del huésped.
-- No borra ni cambia nada existente: agrega dos columnas y una función.

alter table documentos
  add column if not exists calidad text[],
  add column if not exists calidad_motivo text;

create or replace function etiqueta_calidad(t text) returns text language sql immutable as $$
  select case t
    when 'borrosa' then 'borrosa'
    when 'oscura' then 'oscura'
    when 'reflejo' then 'con reflejo'
    when 'cortada' then 'posiblemente cortada'
  end
$$;

create or replace function registrar_documento(
  p_codigo text, p_tipo tipo_doc, p_ruta text, p_fmm_tipo tipo_fmm,
  p_bytes integer, p_ancho integer, p_alto integer, p_nitidez numeric,
  p_calidad text[], p_calidad_motivo text
) returns integer
language plpgsql security definer set search_path = public as $$
declare p perfiles; c codigos_captura; v integer; g uuid; cal text[]; mot text;
begin
  p := exigir_rol('ipad');
  cal := array(select distinct x from unnest(coalesce(p_calidad, '{}')) x order by x);
  if exists (select 1 from unnest(cal) x where etiqueta_calidad(x) is null) then
    raise exception 'Aviso de calidad inválido.' using errcode = 'P0001';
  end if;
  mot := nullif(left(trim(coalesce(p_calidad_motivo, '')), 300), '');
  if cardinality(cal) > 0 and mot is null then
    raise exception 'Escribe por qué se guarda la foto con aviso de calidad.' using errcode = 'P0001';
  end if;
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
                          capturado_por, capturado_por_nombre, calidad, calidad_motivo)
  values (c.expediente_id, p_tipo, v, p_ruta,
          case when p_tipo = 'fmm' then coalesce(p_fmm_tipo, 'fmm') end,
          p_bytes, p_ancho, p_alto, p_nitidez, c.codigo, p.id, p.nombre,
          case when cardinality(cal) > 0 then cal end,
          case when cardinality(cal) > 0 then mot end);
  if cardinality(cal) > 0 then
    select grupo_id into g from expedientes where id = c.expediente_id;
    perform anotar(p, c.expediente_id, g,
      'Guardó la foto de ' || etiqueta_doc(p_tipo) || ' (versión ' || v || ') con aviso de calidad: '
        || (select string_agg(etiqueta_calidad(x), ', ') from unnest(cal) x),
      mot);
  end if;
  return v;
end $$;

-- La versión anterior (sin aviso de calidad) sigue funcionando: guarda la foto sin aviso.
create or replace function registrar_documento(
  p_codigo text, p_tipo tipo_doc, p_ruta text, p_fmm_tipo tipo_fmm,
  p_bytes integer, p_ancho integer, p_alto integer, p_nitidez numeric
) returns integer
language sql security definer set search_path = public as $$
  select registrar_documento(p_codigo, p_tipo, p_ruta, p_fmm_tipo, p_bytes, p_ancho, p_alto, p_nitidez, null::text[], null::text)
$$;

revoke execute on function registrar_documento(text, tipo_doc, text, tipo_fmm, integer, integer, integer, numeric, text[], text),
  etiqueta_calidad(text) from public, anon;
grant execute on function registrar_documento(text, tipo_doc, text, tipo_fmm, integer, integer, integer, numeric, text[], text)
  to authenticated;
