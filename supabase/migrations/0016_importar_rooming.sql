-- Alta de huéspedes desde la rooming list (PDF de Opera o Excel). La página lee el archivo,
-- muestra la vista previa y manda solo las filas que la persona confirmó. Esta función las da
-- de alta en una sola operación: si una fila falla, no entra ninguna. El alta manual sigue igual.
-- Cada huésped queda en la bitácora de su expediente y la importación en la bitácora del grupo.
-- No se guardan número de habitación ni número de reservación de Opera.

create function nombre_comparable(t text) returns text
language sql immutable set search_path = public as $$
  select lower(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'))
$$;

create function importar_huespedes(p_grupo uuid, p_archivo text, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles;
  archivo text := left(trim(coalesce(p_archivo, '')), 200);
  f jsonb;
  n int := 0;
  fila int;
  nom text; ape text; cod text; pais text; pas text; vence date; clave text;
  vistos text[] := '{}';
  omitidas jsonb := '[]'::jsonb;
  e_id uuid;
begin
  p := exigir_rol('grupos', 'frontdesk', 'admin');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if archivo = '' then archivo := 'sin nombre'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'No hay huéspedes para dar de alta.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_filas) > 1500 then
    raise exception 'Son demasiadas filas para una sola importación (máximo 1,500).' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(nombre_comparable(nombre) || '|' || nombre_comparable(apellidos)), '{}')
    into vistos from expedientes where grupo_id = p_grupo;

  for f in select * from jsonb_array_elements(p_filas) loop
    fila := coalesce((f->>'fila')::int, 0);
    nom := trim(coalesce(f->>'nombre', ''));
    ape := trim(coalesce(f->>'apellidos', ''));
    cod := upper(trim(coalesce(f->>'nac_codigo', '')));
    pais := trim(coalesce(f->>'nac_nombre', ''));
    pas := nullif(upper(regexp_replace(coalesce(f->>'pasaporte', ''), '\s', '', 'g')), '');
    vence := nullif(f->>'pasaporte_vence', '')::date;
    if length(nom) not between 1 and 120 or length(ape) not between 1 and 120 then
      raise exception 'Fila %: falta el nombre o los apellidos.', fila using errcode = 'P0001';
    end if;
    if cod !~ '^[A-Z]{3}$' or length(pais) not between 2 and 80 then
      raise exception 'Fila %: elige la nacionalidad de la lista.', fila using errcode = 'P0001';
    end if;
    if pas is not null and length(pas) > 30 then
      raise exception 'Fila %: el número de pasaporte es demasiado largo.', fila using errcode = 'P0001';
    end if;
    if vence is not null and (vence < date '2000-01-01' or vence > date '2100-01-01') then
      raise exception 'Fila %: la fecha de vencimiento del pasaporte no es válida.', fila using errcode = 'P0001';
    end if;

    -- Un huésped que ya está en el grupo (o repetido en el archivo) solo entra si la persona
    -- lo confirmó en la vista previa: por ejemplo, dos personas distintas con el mismo nombre.
    clave := nombre_comparable(nom) || '|' || nombre_comparable(ape);
    if clave = any(vistos) and coalesce((f->>'duplicado_ok')::boolean, false) is not true then
      omitidas := omitidas || jsonb_build_object('fila', fila, 'nombre', nom || ' ' || ape,
        'motivo', 'Ya estaba dado de alta en el grupo');
      continue;
    end if;
    vistos := vistos || clave;

    insert into expedientes (grupo_id, nombre, apellidos, nacionalidad_codigo, nacionalidad, pasaporte, pasaporte_vence, creado_por)
    values (p_grupo, nom, ape, cod, pais, pas, vence, p.id)
    returning id into e_id;
    perform anotar(p, e_id, p_grupo, 'Alta del huésped desde la rooming list (' || archivo || ')');
    if vence is not null then
      perform anotar(p, e_id, p_grupo, 'Registró vencimiento del pasaporte: ' || to_char(vence, 'DD/MM/YYYY'));
    end if;
    n := n + 1;
  end loop;

  perform anotar(p, null, p_grupo,
    'Importó la rooming list «' || archivo || '»: ' || n || case when n = 1 then ' huésped dado de alta' else ' huéspedes dados de alta' end
    || case when jsonb_array_length(omitidas) > 0
         then ', ' || jsonb_array_length(omitidas) || ' ya estaban en el grupo' else '' end);
  return jsonb_build_object('altas', n, 'omitidas', omitidas);
end $$;

revoke execute on function importar_huespedes(uuid, text, jsonb), nombre_comparable(text) from public, anon;
grant execute on function importar_huespedes(uuid, text, jsonb) to authenticated;
