-- Fija el search_path de las funciones auxiliares (recomendación del revisor de seguridad de Supabase).
alter function no_borrar() set search_path = public;
alter function no_modificar() set search_path = public;
alter function etiqueta_rol(rol_area) set search_path = public;
alter function etiqueta_doc(tipo_doc) set search_path = public;
