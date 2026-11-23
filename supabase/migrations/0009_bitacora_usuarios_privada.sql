-- Las entradas de administración de usuarios solo las ve Administración.
alter policy bitacora_pc on bitacora
  using (rol_actual() in ('admin', 'grupos', 'frontdesk', 'credito', 'impuestos')
         and (usuario_afectado is null or rol_actual() = 'admin'));
