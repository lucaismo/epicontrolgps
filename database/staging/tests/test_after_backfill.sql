\set ON_ERROR_STOP on
SELECT test.eq((SELECT count(*)::text FROM public.colaboradores WHERE organization_id = '10000000-0000-0000-0000-000000000001'), '5', 'Cinco colaboradores reconciliados na In-Haus local');
SELECT test.eq((SELECT count(*)::text FROM public.epis WHERE organization_id = '10000000-0000-0000-0000-000000000001'), '5', 'Cinco EPIs reconciliados');
SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE organization_id = '10000000-0000-0000-0000-000000000001'), '3', 'Três movimentações reconciliadas');
SELECT test.eq((SELECT count(*)::text FROM public.inventario_itens WHERE diferenca = -8), '1', 'Coluna gerada diferenca preservada no backfill');
SELECT test.ok((SELECT count(*) > 0 FROM public.auditoria WHERE operacao = 'UPDATE' AND dados_novos ->> 'organization_id' = '10000000-0000-0000-0000-000000000001'), 'Triggers originais de auditoria registram o backfill');
