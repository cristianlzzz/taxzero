-- Datos del grupo editables después del alta y alta sin fechas pasadas.
-- Solo agrega o reemplaza funciones; no cambia ni borra datos.

-- Fecha de hoy en el hotel (Cancún, UTC-5 todo el año).
create or replace function hoy_hotel() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'America/Cancun')::date
$$;

-- El alta ya no acepta grupos con llegada anterior a hoy.
create or replace function crear_grupo(
  p_nombre text, p_empresa text, p_contacto text, p_codigo_opera text,
  p_llegada date, p_salida date, p_estimados integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare p perfiles; g_id uuid;
begin
  p := exigir_rol('grupos', 'admin');
  if p_llegada < hoy_hotel() then
    raise exception 'La llegada no puede ser anterior a hoy.' using errcode = 'P0001';
  end if;
  insert into grupos (nombre, empresa, contacto, codigo_opera, llegada, salida, estimados, creado_por)
  values (trim(p_nombre), trim(p_empresa), nullif(trim(p_contacto), ''), nullif(upper(trim(p_codigo_opera)), ''),
          p_llegada, p_salida, p_estimados, p.id)
  returning id into g_id;
  perform anotar(p, null, g_id, 'Alta del grupo');
  return g_id;
end $$;

-- Corrige los datos del grupo. Cada dato que cambia deja una línea en la bitácora del grupo
-- con el valor anterior y el nuevo, y el motivo es obligatorio.
-- Reglas:
--  * Solo Grupos y Administración.
--  * Si el grupo ya tiene expedientes cerrados por Impuestos, la empresa y las fechas de estancia
--    quedan fijas (ya respaldan un cierre). Para corregirlas, Impuestos reabre esos expedientes.
--  * Un grupo que todavía no llega no puede moverse a una llegada anterior a hoy. Un grupo que
--    ya llegó sí puede corregir su llegada a una fecha pasada.
create function editar_grupo(
  p_grupo uuid, p_nombre text, p_empresa text, p_contacto text, p_codigo_opera text,
  p_llegada date, p_salida date, p_estimados integer, p_motivo text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  p perfiles; g grupos;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_empresa text := trim(coalesce(p_empresa, ''));
  v_contacto text := nullif(trim(coalesce(p_contacto, '')), '');
  v_codigo text := nullif(upper(trim(coalesce(p_codigo_opera, ''))), '');
  v_motivo text := trim(coalesce(p_motivo, ''));
  cambios text[] := '{}';
  c text;
  fmt constant text := 'DD/MM/YYYY';
begin
  p := exigir_rol('grupos', 'admin');
  select * into g from grupos where id = p_grupo for update;
  if g.id is null then raise exception 'El grupo no existe.' using errcode = 'P0002'; end if;
  if length(v_motivo) < 3 then raise exception 'Escribe el motivo del cambio.' using errcode = 'P0001'; end if;
  if length(v_nombre) < 2 or length(v_empresa) < 1 or p_llegada is null or p_salida is null then
    raise exception 'Llena nombre, empresa, llegada y salida.' using errcode = 'P0001';
  end if;
  if p_salida < p_llegada then raise exception 'La salida no puede ser antes de la llegada.' using errcode = 'P0001'; end if;

  if (v_empresa is distinct from g.empresa or p_llegada is distinct from g.llegada or p_salida is distinct from g.salida)
     and exists (select 1 from expedientes where grupo_id = g.id and estado = 'cerrado') then
    raise exception 'Este grupo ya tiene expedientes cerrados por Impuestos: la empresa y las fechas de estancia ya no se pueden cambiar. Si hay un error, Impuestos debe reabrir esos expedientes primero.'
      using errcode = 'P0001';
  end if;
  if p_llegada is distinct from g.llegada and g.llegada > hoy_hotel() and p_llegada < hoy_hotel() then
    raise exception 'La llegada no puede ser anterior a hoy.' using errcode = 'P0001';
  end if;

  if v_nombre is distinct from g.nombre then
    cambios := cambios || format('Cambió el nombre del grupo: «%s» → «%s»', g.nombre, v_nombre);
  end if;
  if v_empresa is distinct from g.empresa then
    cambios := cambios || format('Cambió la empresa: «%s» → «%s»', g.empresa, v_empresa);
  end if;
  if v_contacto is distinct from g.contacto then
    cambios := cambios || format('Cambió el contacto: «%s» → «%s»', coalesce(g.contacto, 'sin capturar'), coalesce(v_contacto, 'sin capturar'));
  end if;
  if v_codigo is distinct from g.codigo_opera then
    cambios := cambios || format('Cambió el código de grupo en Opera: «%s» → «%s»', coalesce(g.codigo_opera, 'sin capturar'), coalesce(v_codigo, 'sin capturar'));
  end if;
  if p_llegada is distinct from g.llegada then
    cambios := cambios || format('Cambió la llegada oficial: %s → %s', to_char(g.llegada, fmt), to_char(p_llegada, fmt));
  end if;
  if p_salida is distinct from g.salida then
    cambios := cambios || format('Cambió la salida oficial: %s → %s', to_char(g.salida, fmt), to_char(p_salida, fmt));
  end if;
  if p_estimados is distinct from g.estimados then
    cambios := cambios || format('Cambió los huéspedes estimados: %s → %s', coalesce(g.estimados::text, 'sin capturar'), coalesce(p_estimados::text, 'sin capturar'));
  end if;

  if cardinality(cambios) = 0 then
    raise exception 'No cambiaste ningún dato.' using errcode = 'P0001';
  end if;

  update grupos set nombre = v_nombre, empresa = v_empresa, contacto = v_contacto, codigo_opera = v_codigo,
                    llegada = p_llegada, salida = p_salida, estimados = p_estimados
   where id = g.id;
  foreach c in array cambios loop
    perform anotar(p, null, g.id, c, v_motivo);
  end loop;
  return cardinality(cambios);
end $$;

revoke execute on function hoy_hotel(), editar_grupo(uuid, text, text, text, text, date, date, integer, text) from public, anon;
grant execute on function hoy_hotel(), editar_grupo(uuid, text, text, text, text, date, date, integer, text) to authenticated;
