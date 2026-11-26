-- EPI Guard SaaS — Fase 1 / reconciliação e fechamento
-- Executar somente após todos os lotes retornarem zero pendências.

DO $$
DECLARE
  v_tabela text;
  v_pending bigint;
  v_control public.migration_control%ROWTYPE;
BEGIN
  SELECT * INTO v_control FROM public.migration_control WHERE singleton = true FOR UPDATE;
  IF v_control.bootstrap_organization_id IS NULL THEN
    RAISE EXCEPTION 'A organização inicial não foi configurada.';
  END IF;
  IF v_control.backfill_concluido THEN
    RAISE EXCEPTION 'O backfill já foi concluído.';
  END IF;
  IF jsonb_array_length(v_control.triggers_originais) <> 11 THEN
    RAISE EXCEPTION 'Baseline esperado de 11 triggers originais não confere.';
  END IF;

  FOREACH v_tabela IN ARRAY ARRAY[
    'colaboradores', 'epis', 'movimentacoes', 'inventarios', 'inventario_itens',
    'compras_config', 'pedidos_compra', 'compras_ajustes', 'colaborador_tamanhos'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', v_tabela)
      INTO v_pending;
    IF v_pending <> 0 THEN
      RAISE EXCEPTION 'Reconciliação incompleta: % possui % linhas sem organization_id.', v_tabela, v_pending;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.colaboradores ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.epis ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.movimentacoes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.inventarios ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.inventario_itens ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.compras_config ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.pedidos_compra ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.compras_ajustes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.colaborador_tamanhos ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.colaboradores VALIDATE CONSTRAINT colaboradores_organization_fkey;
ALTER TABLE public.epis VALIDATE CONSTRAINT epis_organization_fkey;
ALTER TABLE public.movimentacoes VALIDATE CONSTRAINT movimentacoes_organization_fkey;
ALTER TABLE public.inventarios VALIDATE CONSTRAINT inventarios_organization_fkey;
ALTER TABLE public.inventario_itens VALIDATE CONSTRAINT inventario_itens_organization_fkey;
ALTER TABLE public.compras_config VALIDATE CONSTRAINT compras_config_organization_fkey;
ALTER TABLE public.pedidos_compra VALIDATE CONSTRAINT pedidos_compra_organization_fkey;
ALTER TABLE public.compras_ajustes VALIDATE CONSTRAINT compras_ajustes_organization_fkey;
ALTER TABLE public.colaborador_tamanhos VALIDATE CONSTRAINT colaborador_tamanhos_organization_fkey;
ALTER TABLE public.colaborador_tamanhos VALIDATE CONSTRAINT colaborador_tamanhos_org_colaborador_fkey;
ALTER TABLE public.movimentacoes VALIDATE CONSTRAINT movimentacoes_org_epi_fkey;
ALTER TABLE public.movimentacoes VALIDATE CONSTRAINT movimentacoes_org_colaborador_fkey;
ALTER TABLE public.inventario_itens VALIDATE CONSTRAINT inventario_itens_org_inventario_fkey;
ALTER TABLE public.inventario_itens VALIDATE CONSTRAINT inventario_itens_org_epi_fkey;
ALTER TABLE public.pedidos_compra VALIDATE CONSTRAINT pedidos_compra_org_epi_fkey;
ALTER TABLE public.compras_ajustes VALIDATE CONSTRAINT compras_ajustes_org_epi_fkey;
ALTER TABLE public.movimentacoes VALIDATE CONSTRAINT movimentacoes_org_vinculo_fkey;

-- As restrições compostas criadas em 001 já substituem a unicidade global.
ALTER TABLE public.colaboradores DROP CONSTRAINT colaboradores_matricula_key;
ALTER TABLE public.colaboradores DROP CONSTRAINT colaboradores_matricula_unique;
ALTER TABLE public.compras_config DROP CONSTRAINT compras_config_singleton_key;

DROP TRIGGER trg_tmp_tenant_update_colaboradores ON public.colaboradores;
DROP TRIGGER trg_tmp_tenant_update_epis ON public.epis;
DROP TRIGGER trg_tmp_tenant_update_movimentacoes ON public.movimentacoes;
DROP TRIGGER trg_tmp_tenant_update_inventarios ON public.inventarios;
DROP TRIGGER trg_tmp_tenant_update_inventario_itens ON public.inventario_itens;
DROP TRIGGER trg_tmp_tenant_update_compras_config ON public.compras_config;
DROP TRIGGER trg_tmp_tenant_update_pedidos_compra ON public.pedidos_compra;
DROP TRIGGER trg_tmp_tenant_update_compras_ajustes ON public.compras_ajustes;
DROP TRIGGER trg_tmp_tenant_update_colaborador_tamanhos ON public.colaborador_tamanhos;

CREATE POLICY "Isolamento tenant colaboradores" ON public.colaboradores
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant EPIs" ON public.epis
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant movimentações" ON public.movimentacoes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant inventários" ON public.inventarios
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant itens inventário" ON public.inventario_itens
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant configuração compras" ON public.compras_config
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant pedidos compra" ON public.pedidos_compra
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant ajustes compras" ON public.compras_ajustes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());
CREATE POLICY "Isolamento tenant tamanhos" ON public.colaborador_tamanhos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_auth.current_org_id())
  WITH CHECK (organization_id = app_auth.current_org_id());

REVOKE EXECUTE ON FUNCTION public.executar_backfill_lote(text, integer), public.backfill_pending_counts() FROM epi_guard_backfill_worker;

-- Nenhum trigger temporário pode sobreviver.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE 'trg_tmp_%'
  ) THEN
    RAISE EXCEPTION 'Ainda existem triggers temporários com prefixo trg_tmp_.';
  END IF;
END;
$$;

-- Confirma tabela, função, estado e definição dos 11 triggers originais.
DO $$
DECLARE
  v_item jsonb;
  v_current record;
BEGIN
  FOR v_item IN
    SELECT value FROM public.migration_control mc, jsonb_array_elements(mc.triggers_originais)
    WHERE mc.singleton = true
  LOOP
    SELECT t.tgname, c.relname, pn.nspname AS function_schema, p.proname AS function_name,
           t.tgenabled, pg_get_triggerdef(t.oid) AS definition
      INTO v_current
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND c.relname = v_item ->> 'tabela'
       AND t.tgname = v_item ->> 'trigger'
       AND NOT t.tgisinternal;
    IF NOT FOUND
       OR v_current.function_schema || '.' || v_current.function_name <> v_item ->> 'funcao'
       OR v_current.tgenabled <> (v_item ->> 'estado')
       OR v_current.definition <> v_item ->> 'definicao' THEN
      RAISE EXCEPTION 'Trigger original divergente: %.%', v_item ->> 'tabela', v_item ->> 'trigger';
    END IF;
  END LOOP;
END;
$$;

UPDATE public.migration_control
SET backfill_concluido = true, onboarding_aberto = false
WHERE singleton = true;
