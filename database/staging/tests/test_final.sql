\set ON_ERROR_STOP on
-- Estrutura final e preservação dos triggers.
SELECT test.eq((SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'trg_tmp_%' AND NOT tgisinternal), '0', 'Nenhum trigger temporário permanece');
SELECT test.eq((SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'trg_tenant_insert_%' AND NOT tgisinternal), '9', 'Nove triggers permanentes de INSERT por tenant');
SELECT test.eq((SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organization_id' AND is_nullable = 'NO' AND table_name IN ('colaboradores','epis','movimentacoes','inventarios','inventario_itens','compras_config','pedidos_compra','compras_ajustes','colaborador_tamanhos')), '9', 'Nove organization_id NOT NULL após reconciliação');
SELECT test.eq((SELECT count(*)::text FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conname LIKE '%org%fkey' AND NOT convalidated), '0', 'Todas as FKs compostas estão validadas');
SELECT test.eq((
  SELECT count(*)::text FROM public.migration_control mc,
    jsonb_array_elements(mc.triggers_originais) AS original
  WHERE mc.singleton AND NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal
      AND c.relname=original.value->>'tabela'
      AND t.tgname=original.value->>'trigger'
      AND pn.nspname||'.'||p.proname=original.value->>'funcao'
      AND t.tgenabled::text=original.value->>'estado'
      AND pg_get_triggerdef(t.oid)=original.value->>'definicao'
  )), '0', 'Os 11 triggers originais preservam tabela, função, estado e definição');
SELECT test.ok((SELECT NOT has_function_privilege('epi_guard_backfill_worker', 'public.executar_backfill_lote(text,integer)', 'EXECUTE')), 'Worker perde EXECUTE após finalização');
SELECT test.eq((SELECT backfill_concluido::text FROM public.migration_control WHERE singleton), 'true', 'Backfill marcado como concluído');
SELECT test.eq((SELECT onboarding_aberto::text FROM public.migration_control WHERE singleton), 'false', 'Onboarding permanece fechado');
SELECT test.eq((SELECT pg_get_function_identity_arguments('public.registrar_entrega_multipla(uuid,jsonb,text,timestamptz,uuid)'::regprocedure)), 'p_colaborador_id uuid, p_itens jsonb, p_observacao text, p_data_movimentacao timestamp with time zone, p_usuario uuid', 'Assinatura de registrar_entrega_multipla preservada');
SELECT test.eq((SELECT pg_get_function_result('public.registrar_entrega_multipla(uuid,jsonb,text,timestamptz,uuid)'::regprocedure)), 'integer', 'Retorno integer de registrar_entrega_multipla preservado');
SELECT test.eq((SELECT pg_get_function_identity_arguments('public.registrar_entrega_atomica(uuid,uuid,integer,text,timestamptz,uuid,text,uuid,integer,text,text)'::regprocedure)), 'p_colaborador_id uuid, p_epi_id uuid, p_quantidade integer, p_observacao text, p_data_movimentacao timestamp with time zone, p_usuario uuid, p_dev_tipo text, p_dev_epi_id uuid, p_dev_quantidade integer, p_dev_motivo text, p_dev_observacao text', 'Assinatura de registrar_entrega_atomica preservada');
SELECT test.eq((SELECT pg_get_function_identity_arguments('public.editar_entrega(uuid,uuid,integer,timestamptz,text)'::regprocedure)), 'p_mov_id uuid, p_epi_id uuid, p_quantidade integer, p_data_movimentacao timestamp with time zone, p_observacao text', 'Assinatura de editar_entrega preservada');
SELECT test.eq((SELECT pg_get_function_identity_arguments('public.excluir_entrega(uuid,uuid)'::regprocedure)), 'p_mov_id uuid, p_usuario uuid', 'Assinatura de excluir_entrega preservada');

-- Abre temporariamente o onboarding somente no banco local para os testes negativos entre tenants.
UPDATE public.migration_control SET onboarding_aberto = true WHERE singleton;
INSERT INTO public.organizations (id, nome, slug) VALUES
  ('10000000-0000-0000-0000-000000000002', 'Segunda Organização Local', 'segunda-organizacao-local');
UPDATE public.migration_control SET onboarding_aberto = false WHERE singleton;
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'admin');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organizations (nome, slug) VALUES ('Terceira Organização Bloqueada', 'terceira-organizacao-bloqueada');
    RAISE EXCEPTION 'FALHA: onboarding reabriu sem autorização';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Onboarding volta a bloquear novas organizações após finalização');
  END;
END;
$$;

-- Segundo tenant: mesma matrícula permitida e INSERT sem organization_id atribuído pelo claim.
SELECT test.claims('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
INSERT INTO public.colaboradores (id, nome, matricula, funcao) VALUES
  ('c0000000-0000-0000-0000-000000000101', 'Colaborador da Organização Dois', '000001', 'Operador');
INSERT INTO public.epis (id, nome, categoria, estoque_atual) VALUES
  ('d0000000-0000-0000-0000-000000000101', 'Capacete Organização Dois', 'Proteção da cabeça', 10);
SELECT test.eq((SELECT organization_id::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000101'), '10000000-0000-0000-0000-000000000002', 'INSERT do segundo tenant recebe seu próprio organization_id');
SELECT test.eq((SELECT count(*)::text FROM public.colaboradores WHERE matricula='000001'), '1', 'RLS mostra somente a matrícula do próprio tenant');
SELECT test.eq((SELECT count(*)::text FROM public.epis), '1', 'RLS do segundo tenant isola os cinco EPIs In-Haus');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes), '0', 'RLS isola movimentações de outro tenant');
SELECT test.eq((SELECT count(*)::text FROM public.inventarios), '0', 'RLS isola inventários de outro tenant');
SELECT test.eq((SELECT count(*)::text FROM public.inventario_itens), '0', 'RLS isola itens de inventário de outro tenant');
SELECT test.eq((SELECT count(*)::text FROM public.compras_config), '0', 'RLS isola configuração de compras de outro tenant');
SELECT test.eq((SELECT count(*)::text FROM public.pedidos_compra), '0', 'RLS isola pedidos de compra de outro tenant');
SELECT test.eq((SELECT count(*)::text FROM public.compras_ajustes), '0', 'RLS isola ajustes de compra de outro tenant');
SELECT test.eq((SELECT count(*)::text FROM public.colaborador_tamanhos), '0', 'RLS isola tamanhos de outro tenant');
RESET ROLE;

-- In-Haus não enxerga registros do segundo tenant.
SELECT test.claims('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT test.eq((SELECT count(*)::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000101'), '0', 'In-Haus não lê EPI do segundo tenant');
SELECT test.eq((SELECT count(*)::text FROM public.colaboradores WHERE id='c0000000-0000-0000-0000-000000000101'), '0', 'In-Haus não lê colaborador do segundo tenant');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.epis (organization_id, nome, categoria)
    VALUES ('10000000-0000-0000-0000-000000000002', 'EPI Cruzado', 'Teste');
    RAISE EXCEPTION 'FALHA: INSERT cruzado foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'INSERT explícito para outro tenant é rejeitado');
  END;
END;
$$;

-- DML direto em movimentações não pode contornar os locks e a reversão das RPCs.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.movimentacoes (tipo, epi_id, quantidade)
    VALUES ('entrega', 'd0000000-0000-0000-0000-000000000002', 1);
    RAISE EXCEPTION 'FALHA: INSERT direto foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'INSERT direto em movimentacoes é revogado');
  END;
  BEGIN
    DELETE FROM public.movimentacoes WHERE id='e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FALHA: DELETE direto foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'DELETE direto em movimentacoes é revogado');
  END;
END;
$$;

-- Payload inválido e duplicidade são rejeitados antes de qualquer escrita.
DO $$
BEGIN
  BEGIN
    PERFORM public.registrar_entrega_multipla(
      'c0000000-0000-0000-0000-000000000001', '{"epi_id":"x"}'::jsonb, NULL, now(),
      'a0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FALHA: objeto JSON foi aceito como array';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'p_itens não array é rejeitado');
  END;
  BEGIN
    PERFORM public.registrar_entrega_multipla(
      'c0000000-0000-0000-0000-000000000001',
      '[{"epi_id":"d0000000-0000-0000-0000-000000000002","quantidade":1},{"epi_id":"d0000000-0000-0000-0000-000000000002","quantidade":1}]'::jsonb,
      NULL, now(), 'a0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FALHA: EPI duplicado foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'EPI duplicado no mesmo lote é rejeitado');
  END;
  BEGIN
    PERFORM public.registrar_entrega_multipla(
      'c0000000-0000-0000-0000-000000000001',
      '[{"epi_id":"d0000000-0000-0000-0000-000000000002","quantidade":1.5}]'::jsonb,
      NULL, now(), 'a0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FALHA: quantidade fracionária foi aceita';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Quantidade fracionária é rejeitada');
  END;
  BEGIN
    PERFORM public.registrar_entrega_multipla(
      'c0000000-0000-0000-0000-000000000001',
      '[{"epi_id":"d0000000-0000-0000-0000-000000000101","quantidade":1}]'::jsonb,
      NULL, now(), 'a0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FALHA: EPI de outro tenant foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'RPC rejeita EPI de outro tenant');
  END;
END;
$$;
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000002'), '20', 'Payloads rejeitados não alteram estoque');

-- Dois tamanhos do mesmo item-base: a segunda entrega não pode trocar a primeira do próprio lote.
SELECT test.eq(public.registrar_entrega_multipla(
  'c0000000-0000-0000-0000-000000000001',
  '[{"epi_id":"d0000000-0000-0000-0000-000000000002","quantidade":2},{"epi_id":"d0000000-0000-0000-0000-000000000003","quantidade":1}]'::jsonb,
  'Lote local com tamanhos repetidos', '2026-02-01T12:00:00Z',
  'a0000000-0000-0000-0000-000000000001')::text, '2', 'Entrega múltipla preserva retorno integer=2');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='entrega'), '2', 'Duas entregas gravadas');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='troca'), '1', 'Somente o saldo anterior real gera troca');
SELECT test.eq((SELECT epi_id::text FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='troca'), 'd0000000-0000-0000-0000-000000000001', 'Troca usa Camisa M anterior, nunca a entrega do próprio lote');
SELECT test.eq((SELECT quantidade::text FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='troca'), '2', 'Troca preserva LEAST(nova quantidade, saldo anterior)');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes d JOIN public.movimentacoes t ON t.id=d.movimentacao_vinculada_id WHERE d.data_movimentacao='2026-02-01T12:00:00Z'), '1', 'Entrega e troca possuem vínculo explícito');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000001'), '8', 'Troca não altera estoque físico');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000002'), '18', 'Entrega Camisa G baixa duas unidades');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000003'), '19', 'Entrega Camisa GG baixa uma unidade');

-- Técnico pode entregar, mas não editar nem excluir; COALESCE impede autorização nula.
SELECT test.claims('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
DO $$
BEGIN
  BEGIN
    PERFORM public.editar_entrega((SELECT id FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='entrega' AND epi_id='d0000000-0000-0000-0000-000000000002'), 'd0000000-0000-0000-0000-000000000002', 1, NULL, 'Não autorizado');
    RAISE EXCEPTION 'FALHA: técnico editou entrega';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Técnico não edita entrega');
  END;
  BEGIN
    PERFORM public.excluir_entrega((SELECT id FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='entrega' AND epi_id='d0000000-0000-0000-0000-000000000002'), 'b0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FALHA: técnico excluiu entrega';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Técnico não exclui entrega');
  END;
END;
$$;
SELECT test.claims('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');

-- Edição recalcula estoque e a troca vinculada.
SELECT public.editar_entrega(
  (SELECT id FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='entrega' AND epi_id='d0000000-0000-0000-0000-000000000002'),
  'd0000000-0000-0000-0000-000000000002', 1, '2026-02-01T13:00:00Z', 'Edição local');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000002'), '19', 'Edição de 2 para 1 devolve uma unidade ao estoque');
SELECT test.eq((SELECT t.quantidade::text FROM public.movimentacoes d JOIN public.movimentacoes t ON t.id=d.movimentacao_vinculada_id WHERE d.data_movimentacao='2026-02-01T13:00:00Z'), '1', 'Edição recalcula troca vinculada para LEAST(1, saldo anterior)');
SELECT test.ok((SELECT count(*) > 0 FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='UPDATE' AND registro_id=(SELECT id FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T13:00:00Z' AND tipo='entrega')), 'Edição é registrada pela auditoria original');

-- Exclusão devolve estoque, remove somente o vínculo explícito e restaura a posse antiga.
SELECT public.excluir_entrega(
  (SELECT id FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T13:00:00Z' AND tipo='entrega'),
  'a0000000-0000-0000-0000-000000000001');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000002'), '20', 'Exclusão devolve a quantidade editada ao estoque');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE data_movimentacao IN ('2026-02-01T12:00:00Z','2026-02-01T13:00:00Z') AND epi_id='d0000000-0000-0000-0000-000000000002'), '0', 'Exclusão remove a entrega vinculada');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE tipo='troca' AND epi_id='d0000000-0000-0000-0000-000000000001'), '0', 'Exclusão remove somente a troca referenciada');
SELECT test.eq((SELECT COALESCE(SUM(CASE WHEN tipo='entrega' THEN quantidade WHEN tipo IN ('troca','devolucao_normal','avariado','descarte','perda','roubo') THEN -quantidade ELSE 0 END),0)::text FROM public.movimentacoes WHERE colaborador_id='c0000000-0000-0000-0000-000000000001' AND epi_id='d0000000-0000-0000-0000-000000000001'), '2', 'Exclusão restaura a posse histórica da Camisa M');
SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='DELETE' AND dados_anteriores->>'observacao'='Edição local'), '1', 'Exclusão da entrega permanece na auditoria');
SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='DELETE' AND dados_anteriores->>'tipo'='troca' AND dados_anteriores->>'motivo'='Substituição automática por nova entrega'), '1', 'Exclusão da troca vinculada permanece na auditoria');

-- Entrega sem troca pode mudar de EPI e depois ser excluída sem divergência.
SELECT public.editar_entrega(
  (SELECT id FROM public.movimentacoes WHERE data_movimentacao='2026-02-01T12:00:00Z' AND tipo='entrega' AND epi_id='d0000000-0000-0000-0000-000000000003'),
  'd0000000-0000-0000-0000-000000000004', 2, NULL, 'Mudança de EPI');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000003'), '20', 'Mudança de EPI devolve estoque original');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000004'), '47', 'Mudança de EPI baixa estoque novo, considerando a entrega legada');
SELECT public.excluir_entrega((SELECT id FROM public.movimentacoes WHERE observacao='Mudança de EPI'), 'a0000000-0000-0000-0000-000000000001');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000004'), '49', 'Exclusão após mudança de EPI restaura estoque ao valor anterior');

-- RPC atômica: devolução normal soma estoque e é revertida na exclusão; edição não altera sua quantidade.
SELECT public.registrar_entrega_atomica(
  'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000005', 2,
  'Entrega atômica local', '2026-02-02T12:00:00Z', 'a0000000-0000-0000-0000-000000000001',
  'devolucao_normal', 'd0000000-0000-0000-0000-000000000004', 1, 'Devolução local', 'Devolução pareada');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000004'), '50', 'Devolução normal soma estoque');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000005'), '28', 'Entrega atômica baixa estoque');
SELECT public.editar_entrega((SELECT id FROM public.movimentacoes WHERE observacao='Entrega atômica local'), 'd0000000-0000-0000-0000-000000000005', 1, NULL, 'Entrega atômica editada');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000005'), '29', 'Edição atômica ajusta somente a entrega');
SELECT test.eq((SELECT quantidade::text FROM public.movimentacoes WHERE motivo='Devolução local'), '1', 'Edição preserva quantidade da devolução vinculada');
SELECT public.excluir_entrega((SELECT id FROM public.movimentacoes WHERE observacao='Entrega atômica editada'), 'a0000000-0000-0000-0000-000000000001');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000004'), '49', 'Exclusão reverte a entrada da devolução');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000005'), '30', 'Exclusão atômica restaura estoque da entrega');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE motivo='Devolução local' OR observacao='Entrega atômica editada'), '0', 'Exclusão atômica remove os dois lados pelo vínculo');

-- Histórico legado: candidata ambígua bloqueia; ausência comprovada de candidatas permite excluir.
DO $$
BEGIN
  BEGIN
    PERFORM public.excluir_entrega('e0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FALHA: legado ambíguo foi excluído';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Exclusão legada ambígua exige reconciliação explícita');
  END;
END;
$$;
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE id IN ('e0000000-0000-0000-0000-000000000010','e0000000-0000-0000-0000-000000000011')), '2', 'Falha na exclusão preserva entrega e troca legadas');
SELECT public.excluir_entrega('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000001'), '10', 'Entrega legada sem candidatas pode ser excluída com reversão correta');
RESET ROLE;

-- FK composta impede EPI do tenant 2 em movimentação do tenant 1, inclusive via service_role.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.movimentacoes (organization_id, tipo, epi_id, colaborador_id, quantidade)
    VALUES ('10000000-0000-0000-0000-000000000001', 'entrega',
      'd0000000-0000-0000-0000-000000000101', 'c0000000-0000-0000-0000-000000000003', 1);
    RAISE EXCEPTION 'FALHA: FK cruzada foi aceita';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'FK composta rejeita EPI de outra organização');
  END;
  BEGIN
    INSERT INTO public.movimentacoes (organization_id, tipo, epi_id, colaborador_id, quantidade)
    VALUES ('10000000-0000-0000-0000-000000000001', 'entrega',
      'd0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000101', 1);
    RAISE EXCEPTION 'FALHA: colaborador cruzado foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'FK composta rejeita colaborador de outra organização');
  END;
END;
$$;

-- Reconciliação legada manual e exclusividade 1:1 do vínculo.
UPDATE public.movimentacoes SET movimentacao_vinculada_id='e0000000-0000-0000-0000-000000000011'
WHERE id='e0000000-0000-0000-0000-000000000010';
SELECT test.eq((SELECT movimentacao_vinculada_id::text FROM public.movimentacoes WHERE id='e0000000-0000-0000-0000-000000000010'), 'e0000000-0000-0000-0000-000000000011', 'Legado pode ser reconciliado explicitamente, sem inferência automática');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.movimentacoes (organization_id, tipo, epi_id, colaborador_id, quantidade, movimentacao_vinculada_id)
    VALUES ('10000000-0000-0000-0000-000000000001', 'entrega',
      'd0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', 1,
      'e0000000-0000-0000-0000-000000000011');
    RAISE EXCEPTION 'FALHA: troca foi vinculada a duas entregas';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Constraint garante vínculo exclusivo um-para-um');
  END;
  BEGIN
    DELETE FROM public.movimentacoes WHERE id='e0000000-0000-0000-0000-000000000011';
    RAISE EXCEPTION 'FALHA: troca referenciada foi excluída diretamente';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'FK ON DELETE RESTRICT impede excluir primeiro a troca referenciada');
  END;
END;
$$;
SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000004'), '49', 'Falhas de vínculo fazem rollback do efeito de estoque');
RESET ROLE;

-- Fallback por membership única continua compatível; múltiplas memberships exigem claim.
SELECT set_config('request.jwt.claims', jsonb_build_object('sub','a0000000-0000-0000-0000-000000000001','role','authenticated')::text, false);
SELECT test.eq(app_auth.current_org_id()::text, '10000000-0000-0000-0000-000000000001', 'Sem app_metadata, membership única resolve o tenant');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'admin');
DO $$
BEGIN
  BEGIN
    PERFORM app_auth.current_org_id();
    RAISE EXCEPTION 'FALHA: múltiplas organizações sem claim foram aceitas';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Múltiplas memberships sem organization_id no claim são negadas');
  END;
END;
$$;

SELECT count(*) AS testes_aprovados FROM test.results;
