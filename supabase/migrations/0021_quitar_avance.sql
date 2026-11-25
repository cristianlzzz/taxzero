-- Se quita el reporte de Avance. El resumen de grupos deja de calcular los expedientes
-- detenidos y el último movimiento, que solo usaba ese reporte. No se borra ningún dato:
-- solo cambia la vista (una consulta), las tablas y la bitácora quedan igual.
-- Correr en el SQL Editor de Supabase después de fusionar el cambio en la página.

begin;

drop view resumen_grupos;

create view resumen_grupos with (security_invoker = true) as
select g.id, g.folio, g.nombre, g.empresa, g.codigo_opera, g.llegada, g.salida, g.estimados, g.creado_en,
       coalesce((select jsonb_object_agg(estado, n) from (
         select e.estado, count(*) n from expedientes e where e.grupo_id = g.id group by e.estado
       ) c), '{}'::jsonb) as conteo,
       grupo_cancelado(g.id) as cancelado
from grupos g;

grant select on resumen_grupos to authenticated;
revoke all on resumen_grupos from anon;

commit;
