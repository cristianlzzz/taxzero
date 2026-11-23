-- Crea usuarios de PRUEBA (uno por área) directamente en Supabase Auth.
-- Solo para el proyecto de pruebas. Reemplaza las contraseñas antes de ejecutarlo
-- desde el editor SQL de Supabase. En producción los usuarios se crean desde la
-- pantalla "Usuarios" de la app (rol Administración).
do $$
declare
  u record;
  uid uuid;
begin
  for u in
    select * from (values
      ('admin.taxzero@example.com',     'CAMBIAR', 'Administración TI', 'admin'::rol_area),
      ('grupos.taxzero@example.com',    'CAMBIAR', 'Luis Canché',       'grupos'),
      ('frontdesk.taxzero@example.com', 'CAMBIAR', 'Ana Pech',          'frontdesk'),
      ('ipad1.taxzero@example.com',     'CAMBIAR', 'Estación Lobby 1',  'ipad'),
      ('credito.taxzero@example.com',   'CAMBIAR', 'Mariana Uc',        'credito'),
      ('impuestos.taxzero@example.com', 'CAMBIAR', 'Jorge Balam',       'impuestos')
    ) as t(email, clave, nombre, rol)
  loop
    if exists (select 1 from auth.users where email = u.email) then
      continue;
    end if;
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', u.email,
      extensions.crypt(u.clave, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
            jsonb_build_object('sub', uid::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
    insert into public.perfiles (id, nombre, rol) values (uid, u.nombre, u.rol);
  end loop;
end $$;
