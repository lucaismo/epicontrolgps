\set ON_ERROR_STOP on
-- Cada SELECT é uma transação independente no psql com autocommit.
SELECT test.eq(public.executar_backfill_lote('colaboradores', 2)::text, '2', 'Primeiro lote limitado a duas linhas');
SELECT test.eq(public.executar_backfill_lote('colaboradores', 2)::text, '2', 'Segundo lote limitado a duas linhas');
SELECT test.eq(public.executar_backfill_lote('colaboradores', 2)::text, '0', 'Terceiro lote confirma reconciliação de colaboradores');
SELECT test.eq(public.executar_backfill_lote('epis', 1000)::text, '5', 'Backfill de EPIs');
SELECT test.eq(public.executar_backfill_lote('movimentacoes', 1000)::text, '3', 'Backfill de movimentações');
SELECT test.eq(public.executar_backfill_lote('inventarios', 1000)::text, '1', 'Backfill de inventários');
SELECT test.eq(public.executar_backfill_lote('inventario_itens', 1000)::text, '1', 'Backfill com coluna gerada diferenca');
SELECT test.eq(public.executar_backfill_lote('compras_config', 1000)::text, '1', 'Backfill da configuração de compras');
SELECT test.eq(public.executar_backfill_lote('pedidos_compra', 1000)::text, '1', 'Backfill dos pedidos de compra');
SELECT test.eq(public.executar_backfill_lote('compras_ajustes', 1000)::text, '1', 'Backfill dos ajustes de compra');
SELECT test.eq(public.executar_backfill_lote('colaborador_tamanhos', 1000)::text, '1', 'Backfill dos tamanhos');
SELECT test.eq((SELECT count(*)::text FROM public.backfill_pending_counts() AS p), '1', 'Função de pendências retorna um objeto JSON');
SELECT test.eq((SELECT count(*)::text FROM jsonb_each(public.backfill_pending_counts()) WHERE value::text <> '0'), '0', 'Todas as nove tabelas terminam sem organization_id NULL');
