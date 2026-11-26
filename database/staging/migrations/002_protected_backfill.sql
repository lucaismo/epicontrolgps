-- EPI Guard SaaS — Fase 1 / transição protegida
-- Pré-requisito: o administrador do staging provisiona o LOGIN epi_guard_backfill_worker.
-- Nenhum GUC, JWT ou parâmetro é aceito como prova de identidade do worker.

DO $$
BEGIN
  IF to_regrole('epi_guard_backfill_worker') IS NULL THEN
    RAISE EXCEPTION 'Provisione o papel epi_guard_backfill_worker antes desta migration.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.preencher_tenant_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
BEGIN
  IF app_auth.is_backfill_worker() THEN
    RAISE EXCEPTION 'O worker de backfill só pode atualizar organization_id em lotes controlados.';
  END IF;

  IF app_auth.is_service_role() THEN
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION 'service_role deve informar organization_id explicitamente.';
    END IF;
    RETURN NEW;
  END IF;

  v_org := app_auth.current_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Membership ativa é obrigatória para inserir dados operacionais.';
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := v_org;
  ELSIF NEW.organization_id <> v_org THEN
    RAISE EXCEPTION 'organization_id divergente da organização autenticada.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.proteger_tenant_update_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  v_bootstrap uuid;
BEGIN
  IF app_auth.is_backfill_worker() THEN
    SELECT bootstrap_organization_id INTO v_bootstrap
      FROM public.migration_control
     WHERE singleton = true AND NOT backfill_concluido;
    IF v_bootstrap IS NULL THEN
      RAISE EXCEPTION 'Backfill não está configurado ou já foi concluído.';
    END IF;
    IF OLD.organization_id IS NOT NULL
       OR NEW.organization_id IS DISTINCT FROM v_bootstrap THEN
      RAISE EXCEPTION 'O worker só pode executar a transição NULL -> In-Haus.';
    END IF;
    -- Os triggers BEFORE UPDATE originais podem atualizar updated_at. A coluna gerada
    -- inventario_itens.diferenca chega como NULL ao BEFORE UPDATE e é recalculada depois;
    -- ela não é editável diretamente e precisa ser excluída desta comparação estrutural.
    IF (to_jsonb(NEW) - 'organization_id' - 'updated_at' - 'diferenca')
       IS DISTINCT FROM (to_jsonb(OLD) - 'organization_id' - 'updated_at' - 'diferenca') THEN
      RAISE EXCEPTION 'O worker não pode alterar campos além de organization_id, updated_at automático e colunas geradas.';
    END IF;
    RETURN NEW;
  END IF;

  v_org := app_auth.current_org_id();
  IF v_org IS NULL OR OLD.organization_id IS NULL THEN
    RAISE EXCEPTION 'Registro sem tenant reconciliado: somente o worker pode preencher organization_id.';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Alteração de organization_id negada.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_tenant_insert_colaboradores BEFORE INSERT ON public.colaboradores
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_colaboradores BEFORE UPDATE ON public.colaboradores
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_epis BEFORE INSERT ON public.epis
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_epis BEFORE UPDATE ON public.epis
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_movimentacoes BEFORE INSERT ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_movimentacoes BEFORE UPDATE ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_inventarios BEFORE INSERT ON public.inventarios
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_inventarios BEFORE UPDATE ON public.inventarios
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_inventario_itens BEFORE INSERT ON public.inventario_itens
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_inventario_itens BEFORE UPDATE ON public.inventario_itens
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_compras_config BEFORE INSERT ON public.compras_config
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_compras_config BEFORE UPDATE ON public.compras_config
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_pedidos_compra BEFORE INSERT ON public.pedidos_compra
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_pedidos_compra BEFORE UPDATE ON public.pedidos_compra
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_compras_ajustes BEFORE INSERT ON public.compras_ajustes
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_compras_ajustes BEFORE UPDATE ON public.compras_ajustes
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE TRIGGER trg_tenant_insert_colaborador_tamanhos BEFORE INSERT ON public.colaborador_tamanhos
  FOR EACH ROW EXECUTE FUNCTION public.preencher_tenant_insert();
CREATE TRIGGER trg_tmp_tenant_update_colaborador_tamanhos BEFORE UPDATE ON public.colaborador_tamanhos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tenant_update_backfill();

CREATE OR REPLACE FUNCTION public.executar_backfill_lote(p_tabela text, p_tamanho_lote integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  v_rows integer;
BEGIN
  -- session_user permanece o LOGIN original mesmo sob SECURITY DEFINER e SET ROLE.
  IF NOT app_auth.is_backfill_worker() THEN
    RAISE EXCEPTION 'Apenas o LOGIN epi_guard_backfill_worker pode executar o backfill.';
  END IF;
  IF p_tamanho_lote IS NULL OR p_tamanho_lote < 1 OR p_tamanho_lote > 1000 THEN
    RAISE EXCEPTION 'O lote deve conter entre 1 e 1000 linhas.';
  END IF;
  IF p_tabela NOT IN (
    'colaboradores', 'epis', 'movimentacoes', 'inventarios', 'inventario_itens',
    'compras_config', 'pedidos_compra', 'compras_ajustes', 'colaborador_tamanhos'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da lista de backfill: %', p_tabela;
  END IF;

  SELECT bootstrap_organization_id INTO v_org
    FROM public.migration_control
   WHERE singleton = true AND NOT backfill_concluido;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Configure bootstrap_organization_id antes do backfill.';
  END IF;

  -- Uma chamada = um lote = uma transação. O chamador usa autocommit entre chamadas.
  EXECUTE format(
    'WITH selecionados AS (
       SELECT ctid FROM public.%I WHERE organization_id IS NULL LIMIT $1
     )
     UPDATE public.%I AS destino
        SET organization_id = $2
       FROM selecionados
      WHERE destino.ctid = selecionados.ctid',
    p_tabela, p_tabela
  ) USING p_tamanho_lote, v_org;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_pending_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tabela text;
  v_count bigint;
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF NOT (app_auth.is_backfill_worker() OR app_auth.is_service_role()) THEN
    RAISE EXCEPTION 'Sem permissão para consultar o estado do backfill.';
  END IF;
  FOREACH v_tabela IN ARRAY ARRAY[
    'colaboradores', 'epis', 'movimentacoes', 'inventarios', 'inventario_itens',
    'compras_config', 'pedidos_compra', 'compras_ajustes', 'colaborador_tamanhos'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', v_tabela)
      INTO v_count;
    v_result := jsonb_set(v_result, ARRAY[v_tabela], to_jsonb(v_count));
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.preencher_tenant_insert(), public.proteger_tenant_update_backfill() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.executar_backfill_lote(text, integer), public.backfill_pending_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.executar_backfill_lote(text, integer), public.backfill_pending_counts() TO epi_guard_backfill_worker;
GRANT EXECUTE ON FUNCTION public.executar_backfill_lote(text, integer), public.backfill_pending_counts() TO service_role;
