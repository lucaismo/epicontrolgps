-- Massa inteiramente fictícia, somente no PostgreSQL local descartável.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin.local@example.invalid', '{"nome":"Admin Local"}'),
  ('a0000000-0000-0000-0000-000000000002', 'admin2.local@example.invalid', '{"nome":"Admin Dois Local"}'),
  ('b0000000-0000-0000-0000-000000000001', 'tecnico.local@example.invalid', '{"nome":"Técnico Local"}');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000002', 'admin'),
  ('b0000000-0000-0000-0000-000000000001', 'tecnico');

INSERT INTO public.colaboradores (id, nome, matricula, funcao, turno) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Colaborador Local Um', '000001', 'Operador', 'Turno 1'),
  ('c0000000-0000-0000-0000-000000000002', 'Colaborador Local Dois', '000002', 'Operador', 'Turno 2'),
  ('c0000000-0000-0000-0000-000000000003', 'Colaborador Local Três', '000003', 'Operador', 'Turno 3'),
  ('c0000000-0000-0000-0000-000000000004', 'Colaborador Local Quatro', '000004', 'Administrativo', 'Administrativo');

INSERT INTO public.epis (id, nome, categoria, tamanho, estoque_atual, estoque_minimo, custo_unitario) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'Camisa M', 'Vestuário', 'M', 10, 2, 25),
  ('d0000000-0000-0000-0000-000000000002', 'Camisa G', 'Vestuário', 'G', 20, 2, 25),
  ('d0000000-0000-0000-0000-000000000003', 'Camisa GG', 'Vestuário', 'GG', 20, 2, 25),
  ('d0000000-0000-0000-0000-000000000004', 'Luva Nitrílica', 'Proteção das mãos', NULL, 50, 5, 3),
  ('d0000000-0000-0000-0000-000000000005', 'Óculos Incolor', 'Proteção ocular', NULL, 30, 5, 8);

INSERT INTO public.movimentacoes (
  id, tipo, epi_id, colaborador_id, quantidade, usuario_responsavel, data_movimentacao, observacao
) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'entrega', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 2, 'a0000000-0000-0000-0000-000000000001',
   '2026-01-10T12:00:00Z', 'Entrega legada sem troca');

INSERT INTO public.movimentacoes (
  id, tipo, epi_id, colaborador_id, quantidade, usuario_responsavel, data_movimentacao, observacao
) VALUES
  ('e0000000-0000-0000-0000-000000000010', 'entrega', 'd0000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000002', 1, 'a0000000-0000-0000-0000-000000000001',
   '2026-01-11T12:00:00Z', 'Entrega legada ambígua'),
  ('e0000000-0000-0000-0000-000000000011', 'troca', 'd0000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000002', 1, 'a0000000-0000-0000-0000-000000000001',
   '2026-01-11T12:00:00Z', 'Troca legada sem vínculo');

INSERT INTO public.inventarios (id, local, responsavel, descricao) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'Almoxarife local', 'a0000000-0000-0000-0000-000000000001', 'Inventário local');
INSERT INTO public.inventario_itens (inventario_id, epi_id, quantidade_sistema) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 8);
INSERT INTO public.pedidos_compra (epi_id, quantidade, usuario_responsavel) VALUES
  ('d0000000-0000-0000-0000-000000000002', 5, 'a0000000-0000-0000-0000-000000000001');
INSERT INTO public.compras_ajustes (epi_id, ano, mes, quantidade, sugestao_registrada, usuario_responsavel) VALUES
  ('d0000000-0000-0000-0000-000000000002', 2026, 1, 5, 5, 'a0000000-0000-0000-0000-000000000001');
INSERT INTO public.colaborador_tamanhos (colaborador_id, item, tamanho) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'camisa', 'M');

-- Compatibiliza os grants amplos observados no projeto com os papéis locais.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role, epi_guard_backfill_worker;
