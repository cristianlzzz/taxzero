-- Corrección de los datos del huésped (nombre, apellidos, nacionalidad y pasaporte), por ejemplo
-- si se importó mal de la rooming list o se escribió mal en el alta manual.
-- Solo agrega una función; no cambia ni borra datos.
-- Reglas:
--  * Front Desk, Grupos y Administración, con motivo obligatorio.
--  * Solo mientras el expediente no ha pasado la revisión de Grupos (igual que el vencimiento del
--    pasaporte). Después, Crédito o Impuestos lo devuelven a Grupos para corregirlo.
--  * Cada dato que cambia deja una línea en la bitácora del expediente con el valor anterior y el nuevo.
create function editar_huesped(
  p_expediente uuid, p_nombre text, p_apellidos text, p_nac_codigo text, p_nac_nombre text,
  p_pasaporte text, p_motivo text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  p perfiles; e expedientes;
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos text := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_cod text := upper(trim(coalesce(p_nac_codigo, '')));
  v_pais text := trim(coalesce(p_nac_nombre, ''));
  v_pas text := nullif(upper(regexp_replace(coalesce(p_pasaporte, ''), '\s', '', 'g')), '');
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
  if cardinality(cambios) = 0 then
    raise exception 'No cambiaste ningún dato.' using errcode = 'P0001';
  end if;

  update expedientes
     set nombre = v_nombre, apellidos = v_apellidos, nacionalidad_codigo = v_cod, nacionalidad = v_pais,
         pasaporte = v_pas, actualizado_en = now()
   where id = e.id;
  foreach c in array cambios loop
    perform anotar(p, e.id, e.grupo_id, c, v_motivo);
  end loop;
  return cardinality(cambios);
end $$;

revoke execute on function editar_huesped(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function editar_huesped(uuid, text, text, text, text, text, text) to authenticated;
