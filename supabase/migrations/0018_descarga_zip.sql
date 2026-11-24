-- Descarga del expediente completo del grupo en un archivo .zip (Impuestos y Administración):
-- trae todos los documentos originales, incluidos los pasaportes de todos los huéspedes,
-- así que cada descarga queda en la bitácora del grupo (LFPDPPP). Solo reemplaza una función.
create or replace function anotar_descarga(p_grupo uuid, p_que text) returns void
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
  elsif p_que = 'pdf' and g.id is not null and p.rol in ('admin', 'impuestos') then
    perform anotar(p, null, g.id, 'Generó el PDF con los expedientes de todo el grupo');
  elsif p_que = 'zip' and g.id is not null and p.rol in ('admin', 'impuestos') then
    perform anotar(p, null, g.id, 'Descargó el expediente completo del grupo en .zip (todos los documentos originales, incluidos pasaportes)');
  elsif p_que = 'bitacora' and p.rol in ('admin', 'impuestos') then
    perform anotar(p, null, null, 'Descargó en Excel la bitácora general');
  else
    raise exception 'Descarga no permitida.' using errcode = '42501';
  end if;
end $$;
