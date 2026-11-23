-- Conteo de expedientes por estado para las tarjetas de grupos.
-- security_invoker: respeta los permisos de quien consulta.
create view resumen_grupos with (security_invoker = true) as
select g.id, g.folio, g.nombre, g.empresa, g.codigo_opera, g.llegada, g.salida, g.estimados, g.creado_en,
       coalesce((select jsonb_object_agg(estado, n) from (
         select e.estado, count(*) n from expedientes e where e.grupo_id = g.id group by e.estado
       ) c), '{}'::jsonb) as conteo
from grupos g;

grant select on resumen_grupos to authenticated;
revoke all on resumen_grupos from anon;
