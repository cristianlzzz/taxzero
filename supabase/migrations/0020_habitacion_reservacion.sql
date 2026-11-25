-- Habitación y número de reservación de Opera en el expediente del huésped (decisión de Cris,
-- 2026-11-25). Son opcionales: se toman de la rooming list al importar (sobre todo del XML) y se
-- pueden capturar en el alta manual o corregir con "Corregir datos del huésped" (con bitácora).
-- No borra datos: agrega dos columnas y cambia tres funciones. Las versiones anteriores de
-- alta_huesped y editar_huesped se quitan porque las nuevas reciben los dos datos extra.

alter table expedientes add column habitacion text check (length(habitacion) <= 10);
alter table expedientes add column reservacion text check (length(reservacion) <= 20);

-- Alta manual.
drop function alta_huesped(uuid, text, text, text, text, text);
create function alta_huesped(
  p_grupo uuid, p_nombre text, p_apellidos text, p_nac_codigo text, p_nac_nombre text, p_pasaporte text,
  p_habitacion text, p_reservacion text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare p perfiles; e_id uuid;
  v_hab text := nullif(upper(trim(coalesce(p_habitacion, ''))), '');
  v_res text := nullif(upper(trim(coalesce(p_reservacion, ''))), '');
begin
  p := exigir_rol('frontdesk', 'admin');
  if not exists (select 1 from grupos where id = p_grupo) then
    raise exception 'El grupo no existe.' using errcode = 'P0002';
  end if;
  if (v_hab is not null and length(v_hab) > 10) or (v_res is not null and length(v_res) > 20) then
    raise exception 'La habitación o la reservación son demasiado largas.' using errcode = 'P0001';
  end if;
  insert into expedientes (grupo_id, nombre, apellidos, nacionalidad_codigo, nacionalidad, pasaporte, habitacion, reservacion, creado_por)
  values (p_grupo, trim(p_nombre), trim(p_apellidos), upper(p_nac_codigo), trim(p_nac_nombre),
          nullif(upper(regexp_replace(p_pasaporte, '\s', '', 'g')), ''), v_hab, v_res, p.id)
  returning id into e_id;
  perform anotar(p, e_id, p_grupo, 'Alta del huésped en el grupo');
  return e_id;
end $$;

-- Importación desde la rooming list: ahora guarda habitación y reservación si vienen.
create or replace function importar_huespedes(p_grupo uuid, p_archivo text, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles;
  archivo text := left(trim(coalesce(p_archivo, '')), 200);
  f jsonb;
  n int := 0;
  fila int;
  nom text; ape text; cod text; pais text; pas text; vence date; clave text; hab text; res text;
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
    hab := nullif(upper(trim(coalesce(f->>'habitacion', ''))), '');
    res := nullif(upper(trim(coalesce(f->>'reservacion', ''))), '');
    if (hab is not null and length(hab) > 10) or (res is not null and length(res) > 20) then
      raise exception 'Fila %: la habitación o la reservación son demasiado largas.', fila using errcode = 'P0001';
    end if;
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

    insert into expedientes (grupo_id, nombre, apellidos, nacionalidad_codigo, nacionalidad, pasaporte, pasaporte_vence, habitacion, reservacion, creado_por)
    values (p_grupo, nom, ape, cod, pais, pas, vence, hab, res, p.id)
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


-- Corrección de datos del huésped: incluye habitación y reservación.
drop function editar_huesped(uuid, text, text, text, text, text, text);
create function editar_huesped(
  p_expediente uuid, p_nombre text, p_apellidos text, p_nac_codigo text, p_nac_nombre text,
  p_pasaporte text, p_habitacion text, p_reservacion text, p_motivo text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  p perfiles; e expedientes;
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos text := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_cod text := upper(trim(coalesce(p_nac_codigo, '')));
  v_pais text := trim(coalesce(p_nac_nombre, ''));
  v_pas text := nullif(upper(regexp_replace(coalesce(p_pasaporte, ''), '\s', '', 'g')), '');
  v_hab text := nullif(upper(trim(coalesce(p_habitacion, ''))), '');
  v_res text := nullif(upper(trim(coalesce(p_reservacion, ''))), '');
  v_motivo text := trim(coalesce(p_motivo, ''));
  cambios text[] := '{}';
  c text;
begin
  p := exigir_rol('frontdesk', 'grupos', 'admin');
  select * into e from expedientes where id = p_expediente for update;
  if e.id is null then raise exception 'El expediente no existe.' using errcode = 'P0002'; end if;
  if e.estado not in ('pendiente', 'incompleta', 'rev_grupos', 'dev_grupos') then
    raise exception 'Este expediente ya pasó la revisión de Grupos; para corregir sus datos, Crédito o Impuestos deben devolverlo a Grupos.' using errcode = 'P0001';
  end if;
  if length(v_motivo) < 3 then raise exception 'Escribe el motivo del cambio.' using errcode = 'P0001'; end if;
  if length(v_nombre) not between 1 and 120 or length(v_apellidos) not between 1 and 120 then
    raise exception 'Escribe el nombre y los apellidos.' using errcode = 'P0001';
  end if;
  if v_cod !~ '^[A-Z]{3}$' or length(v_pais) not between 2 and 80 then
    raise exception 'Elige la nacionalidad de la lista.' using errcode = 'P0001';
  end if;
  if v_pas is not null and length(v_pas) > 30 then
    raise exception 'El número de pasaporte es demasiado largo.' using errcode = 'P0001';
  end if;

  if v_nombre is distinct from e.nombre then
    cambios := cambios || format('Cambió el nombre: «%s» → «%s»', e.nombre, v_nombre);
  end if;
  if v_apellidos is distinct from e.apellidos then
    cambios := cambios || format('Cambió los apellidos: «%s» → «%s»', e.apellidos, v_apellidos);
  end if;
  if v_cod is distinct from e.nacionalidad_codigo then
    cambios := cambios || format('Cambió la nacionalidad: %s → %s', e.nacionalidad, v_pais);
  end if;
  if v_pas is distinct from e.pasaporte then
    cambios := cambios || format('Cambió el número de pasaporte: %s → %s', coalesce(e.pasaporte, 'sin capturar'), coalesce(v_pas, 'sin capturar'));
  end if;
  if (v_hab is not null and length(v_hab) > 10) or (v_res is not null and length(v_res) > 20) then
    raise exception 'La habitación o la reservación son demasiado largas.' using errcode = 'P0001';
  end if;
  if v_hab is distinct from e.habitacion then
    cambios := cambios || format('Cambió la habitación: %s → %s', coalesce(e.habitacion, 'sin capturar'), coalesce(v_hab, 'sin capturar'));
  end if;
  if v_res is distinct from e.reservacion then
    cambios := cambios || format('Cambió el número de reservación: %s → %s', coalesce(e.reservacion, 'sin capturar'), coalesce(v_res, 'sin capturar'));
  end if;
  if cardinality(cambios) = 0 then
    raise exception 'No cambiaste ningún dato.' using errcode = 'P0001';
  end if;

  update expedientes
     set nombre = v_nombre, apellidos = v_apellidos, nacionalidad_codigo = v_cod, nacionalidad = v_pais,
         pasaporte = v_pas, habitacion = v_hab, reservacion = v_res, actualizado_en = now()
   where id = e.id;
  foreach c in array cambios loop
    perform anotar(p, e.id, e.grupo_id, c, v_motivo);
  end loop;
  return cardinality(cambios);
end $$;


revoke execute on function alta_huesped(uuid, text, text, text, text, text, text, text),
  editar_huesped(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function alta_huesped(uuid, text, text, text, text, text, text, text),
  editar_huesped(uuid, text, text, text, text, text, text, text, text) to authenticated;
