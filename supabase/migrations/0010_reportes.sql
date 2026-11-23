-- Etapa 5: reportes y bitácora general. Solo agrega; no cambia datos.

-- El resumen de grupos ahora dice cuántos expedientes llevan días sin moverse y cuándo fue
-- el último movimiento. Un expediente está detenido si no está cerrado ni marcado como
-- "no aplica" y lleva 3 días o más sin cambios.
create or replace view resumen_grupos with (security_invoker = true) as
select g.id, g.folio, g.nombre, g.empresa, g.codigo_opera, g.llegada, g.salida, g.estimados, g.creado_en,
       coalesce((select jsonb_object_agg(estado, n) from (
         select e.estado, count(*) n from expedientes e where e.grupo_id = g.id group by e.estado
       ) c), '{}'::jsonb) as conteo,
       (select count(*) from expedientes e
         where e.grupo_id = g.id and e.estado not in ('cerrado', 'no_aplica')
           and e.actualizado_en < now() - interval '3 days')::int as detenidos,
       (select max(e.actualizado_en) from expedientes e where e.grupo_id = g.id) as ultimo_movimiento
from grupos g;

create index if not exists bitacora_ts_idx on bitacora (ts desc, id desc);

-- Cada descarga de datos personales queda en la bitácora (LFPDPPP).
create function anotar_descarga(p_grupo uuid, p_que text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; g grupos;
begin
  p := exigir_rol('admin', 'grupos', 'credito', 'impuestos');
  if p_grupo is not null then
    select * into g from grupos where id = p_grupo;
    if g.id is null then raise exception 'El grupo no existe.' using errcode = 'P0002'; end if;
  end if;
  if p_que = 'lista' then
    perform anotar(p, null, g.id, 'Descargó en Excel la lista de huéspedes del grupo');
  elsif p_que = 'bitacora' and p.rol in ('admin', 'impuestos') then
    perform anotar(p, null, null, 'Descargó en Excel la bitácora general');
  else
    raise exception 'Descarga no permitida.' using errcode = '42501';
  end if;
end $$;

revoke execute on function anotar_descarga(uuid, text) from public, anon;
grant execute on function anotar_descarga(uuid, text) to authenticated;
