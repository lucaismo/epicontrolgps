-- Apenas usuários sintéticos adicionais. Nunca usar dados da operação.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('b0000000-0000-0000-0000-000000000002','almox.local@example.invalid','{"nome":"Almox Local"}'),
 ('b0000000-0000-0000-0000-000000000003','lider.local@example.invalid','{"nome":"Líder Local"}'),
 ('b0000000-0000-0000-0000-000000000004','sem-perfil.local@example.invalid','{"nome":"Sem Perfil Local"}');
DELETE FROM public.user_roles WHERE user_id IN (
 'b0000000-0000-0000-0000-000000000002',
 'b0000000-0000-0000-0000-000000000003',
 'b0000000-0000-0000-0000-000000000004');
INSERT INTO public.user_roles(user_id, role) VALUES
 ('b0000000-0000-0000-0000-000000000002','almoxarife'),
 ('b0000000-0000-0000-0000-000000000003','lider');
