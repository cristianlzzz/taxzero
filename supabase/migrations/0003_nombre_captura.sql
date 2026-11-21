-- Guarda el nombre de la estación que tomó cada foto, para mostrarlo en el expediente.
alter table documentos add column capturado_por_nombre text;

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
  if not (p_tipo = any (c.pasos)) then
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
