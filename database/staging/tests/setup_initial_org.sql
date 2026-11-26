-- Organização fictícia exclusivamente local; nunca executar no banco In-Haus.
INSERT INTO public.organizations (id, nome, slug)
VALUES ('10000000-0000-0000-0000-000000000001', 'In-Haus Local de Teste', 'in-haus-local-teste');
UPDATE public.migration_control
SET bootstrap_organization_id = '10000000-0000-0000-0000-000000000001'
WHERE singleton = true;
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'tecnico');
