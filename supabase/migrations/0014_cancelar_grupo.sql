-- Cancelación de grupos. Grupos o Administración cancelan un grupo con motivo obligatorio
-- (por ejemplo, el cliente canceló el evento). Nada se borra: el grupo, sus huéspedes y sus
-- documentos se conservan, y cada cancelación o reactivación queda en esta tabla y en la
-- bitácora del grupo. Mientras está cancelado no se dan de alta huéspedes ni se generan QR.
-- Solo agrega tablas, funciones y disparadores; no cambia datos existentes.

create table cancelaciones_grupo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos (id),
  accion text not null check (accion in ('cancelar', 'reactivar')),
  motivo text not null check (length(trim(motivo)) between 3 and 500),
  registrado_por uuid not null references perfiles (id),
  registrado_por_nombre text not null,
  ts timestamptz not null default now()
);
create index cancelaciones_grupo_idx on cancelaciones_grupo (grupo_id, ts desc, id desc);

create trigger cancel_no_borrar before delete on cancelaciones_grupo for each row execute function no_borrar();
create trigger cancel_no_modificar before update on cancelaciones_grupo for each row execute function no_modificar();
create trigger cancel_no_truncar before truncate on cancelaciones_grupo execute function no_borrar();

alter table cancelaciones_grupo enable row level security;
revoke all on cancelaciones_grupo from anon;
revoke insert, update, delete, truncate on cancelaciones_grupo from authenticated;
grant select on cancelaciones_grupo to authenticated;
create policy cancel_ver on cancelaciones_grupo for select to authenticated
  using (rol_actual() is not null);

-- ¿El grupo está cancelado ahora? Manda el último movimiento (cancelar o reactivar).
create function grupo_cancelado(p_grupo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select accion = 'cancelar' from cancelaciones_grupo
     where grupo_id = p_grupo order by ts desc, id desc limit 1
  ), false)
$$;

create function cancelar_grupo(p_grupo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; m text := trim(coalesce(p_motivo, ''));
begin
  p := exigir_rol('grupos', 'admin');
  perform 1 from grupos where id = p_grupo for update;
  if not found then raise exception 'El grupo no existe.' using errcode = 'P0002'; end if;
  if length(m) < 3 then raise exception 'Escribe el motivo de la cancelación.' using errcode = 'P0001'; end if;
  if grupo_cancelado(p_grupo) then raise exception 'El grupo ya está cancelado.' using errcode = 'P0001'; end if;
  insert into cancelaciones_grupo (grupo_id, accion, motivo, registrado_por, registrado_por_nombre)
  values (p_grupo, 'cancelar', left(m, 500), p.id, p.nombre);
  perform anotar(p, null, p_grupo, 'Canceló el grupo', left(m, 500));
end $$;

create function reactivar_grupo(p_grupo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare p perfiles; m text := trim(coalesce(p_motivo, ''));
begin
  p := exigir_rol('grupos', 'admin');
  perform 1 from grupos where id = p_grupo for update;
  if not found then raise exception 'El grupo no existe.' using errcode = 'P0002'; end if;
  if length(m) < 3 then raise exception 'Escribe el motivo de la reactivación.' using errcode = 'P0001'; end if;
  if not grupo_cancelado(p_grupo) then raise exception 'El grupo no está cancelado.' using errcode = 'P0001'; end if;
  insert into cancelaciones_grupo (grupo_id, accion, motivo, registrado_por, registrado_por_nombre)
  values (p_grupo, 'reactivar', left(m, 500), p.id, p.nombre);
  perform anotar(p, null, p_grupo, 'Reactivó el grupo cancelado', left(m, 500));
end $$;

-- En un grupo cancelado no entran huéspedes nuevos, códigos QR ni fotos.
create function bloquear_si_cancelado() returns trigger
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if tg_table_name = 'expedientes' then
    g := new.grupo_id;
  else
    select grupo_id into g from expedientes where id = new.expediente_id;
  end if;
  if grupo_cancelado(g) then
    raise exception 'Este grupo está cancelado. Para seguir capturando, Grupos debe reactivarlo.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger expedientes_grupo_cancelado before insert on expedientes
  for each row execute function bloquear_si_cancelado();
create trigger codigos_grupo_cancelado before insert on codigos_captura
  for each row execute function bloquear_si_cancelado();
create trigger documentos_grupo_cancelado before insert on documentos
  for each row execute function bloquear_si_cancelado();

-- El resumen de grupos dice si el grupo está cancelado.
create or replace view resumen_grupos with (security_invoker = true) as
select g.id, g.folio, g.nombre, g.empresa, g.codigo_opera, g.llegada, g.salida, g.estimados, g.creado_en,
       coalesce((select jsonb_object_agg(estado, n) from (
         select e.estado, count(*) n from expedientes e where e.grupo_id = g.id group by e.estado
       ) c), '{}'::jsonb) as conteo,
       (select count(*) from expedientes e
         where e.grupo_id = g.id and e.estado not in ('cerrado', 'no_aplica')
           and e.actualizado_en < now() - interval '3 days')::int as detenidos,
       (select max(e.actualizado_en) from expedientes e where e.grupo_id = g.id) as ultimo_movimiento,
       grupo_cancelado(g.id) as cancelado
from grupos g;

revoke execute on function grupo_cancelado(uuid), cancelar_grupo(uuid, text), reactivar_grupo(uuid, text),
  bloquear_si_cancelado() from public, anon;
grant execute on function grupo_cancelado(uuid), cancelar_grupo(uuid, text), reactivar_grupo(uuid, text)
  to authenticated;
