-- EPI Guard SaaS — Fase 1 / RPCs compatíveis, vínculo e locks canônicos
-- Assinaturas públicas preservadas: registrar_entrega_multipla, registrar_entrega_atomica,
-- editar_entrega e excluir_entrega.

CREATE OR REPLACE FUNCTION public.validar_operador_entrega(p_usuario uuid, p_admin_only boolean)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  v_global_ok boolean;
  v_member public.app_role;
BEGIN
  IF p_usuario IS NULL OR auth.uid() IS NULL OR p_usuario IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O responsável informado deve ser o usuário autenticado.';
  END IF;
  v_org := app_auth.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização autenticada não encontrada.'; END IF;

  IF p_admin_only THEN
    v_global_ok := app_auth.has_role(auth.uid(), 'admin');
  ELSE
    v_global_ok := app_auth.has_role(auth.uid(), 'admin')
      OR app_auth.has_role(auth.uid(), 'tecnico')
      OR app_auth.has_role(auth.uid(), 'almoxarife');
  END IF;
  v_member := app_auth.member_role(v_org);
  IF NOT COALESCE(v_global_ok, false) OR v_member IS NULL
     OR (p_admin_only AND v_member <> 'admin')
     OR (NOT p_admin_only AND v_member NOT IN ('admin', 'tecnico', 'almoxarife')) THEN
    RAISE EXCEPTION 'Perfil sem permissão nesta organização.';
  END IF;
  RETURN v_org;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bloquear_colaborador(p_colaborador_id uuid, p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_colaborador_id IS NULL THEN RAISE EXCEPTION 'Entrega sem colaborador não é suportada.'; END IF;
  SELECT id INTO v_id FROM public.colaboradores
   WHERE id = p_colaborador_id AND organization_id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado nesta organização.'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bloquear_epis_ordenados(p_epi_ids uuid[], p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_locked uuid;
  v_expected integer;
  v_count integer := 0;
BEGIN
  SELECT count(DISTINCT id) INTO v_expected FROM unnest(p_epi_ids) AS u(id) WHERE id IS NOT NULL;
  FOR v_id IN
    SELECT DISTINCT id FROM unnest(p_epi_ids) AS u(id) WHERE id IS NOT NULL ORDER BY id
  LOOP
    -- O ORDER BY ordena somente o loop; cada lock é adquirido por um statement separado.
    SELECT id INTO v_locked FROM public.epis
     WHERE id = v_id AND organization_id = p_organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EPI % não encontrado nesta organização.', v_id; END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count <> v_expected THEN RAISE EXCEPTION 'Falha ao bloquear todos os EPIs.'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_vinculo_movimentacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_linked public.movimentacoes%ROWTYPE;
BEGIN
  IF NEW.movimentacao_vinculada_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.tipo <> 'entrega' THEN
    RAISE EXCEPTION 'Somente entregas podem referenciar uma movimentação vinculada.';
  END IF;
  SELECT * INTO v_linked FROM public.movimentacoes
   WHERE id = NEW.movimentacao_vinculada_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimentação vinculada não encontrada.'; END IF;
  IF v_linked.tipo = 'entrega' THEN
    RAISE EXCEPTION 'A movimentação vinculada não pode ser outra entrega.';
  END IF;
  IF NEW.id = v_linked.id OR NEW.colaborador_id IS DISTINCT FROM v_linked.colaborador_id THEN
    RAISE EXCEPTION 'Vínculo inválido: colaborador divergente ou referência circular.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_movimentacao_vinculo
  BEFORE INSERT OR UPDATE ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_vinculo_movimentacao();

CREATE OR REPLACE FUNCTION public.registrar_entrega_multipla(
  p_colaborador_id uuid,
  p_itens jsonb,
  p_observacao text,
  p_data_movimentacao timestamptz,
  p_usuario uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  item jsonb;
  v_org uuid;
  v_epi_id uuid;
  v_qtd integer;
  v_qtd_num numeric;
  v_cat text;
  v_nome text;
  v_item text;
  v_obs text;
  prev record;
  n integer := 0;
  v_epi_ids uuid[] := '{}'::uuid[];
  v_lock_ids uuid[];
  v_entregas_lote uuid[] := '{}'::uuid[];
  v_troca_id uuid;
  v_entrega_id uuid;
BEGIN
  v_org := public.validar_operador_entrega(p_usuario, false);

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'p_itens deve ser um array JSON.';
  END IF;
  IF jsonb_array_length(p_itens) < 1 OR jsonb_array_length(p_itens) > 5 THEN
    RAISE EXCEPTION 'Informe de 1 a 5 EPIs por operação.';
  END IF;

  -- Validação integral antes de qualquer lock ou escrita.
  FOR item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF jsonb_typeof(item) <> 'object'
       OR jsonb_typeof(item -> 'epi_id') <> 'string'
       OR jsonb_typeof(item -> 'quantidade') <> 'number' THEN
      RAISE EXCEPTION 'Cada item deve conter epi_id UUID e quantidade numérica.';
    END IF;
    v_epi_id := (item ->> 'epi_id')::uuid;
    v_qtd_num := (item ->> 'quantidade')::numeric;
    IF v_qtd_num <> trunc(v_qtd_num) OR v_qtd_num < 1 OR v_qtd_num > 2147483647 THEN
      RAISE EXCEPTION 'Quantidade deve ser um inteiro maior que zero.';
    END IF;
    IF v_epi_id = ANY(v_epi_ids) THEN
      RAISE EXCEPTION 'EPI duplicado no lote: %', v_epi_id;
    END IF;
    v_epi_ids := array_append(v_epi_ids, v_epi_id);
  END LOOP;

  -- 1) Lock do colaborador, compartilhado por todas as rotinas de posse.
  PERFORM public.bloquear_colaborador(p_colaborador_id, v_org);

  -- 2) União dos EPIs novos e dos que participam do histórico de posse. O lock do
  -- colaborador impede que esse conjunto mude por outra entrega/edição/exclusão concorrente.
  SELECT array_agg(DISTINCT epi_id) INTO v_lock_ids
  FROM (
    SELECT unnest(v_epi_ids) AS epi_id
    UNION
    SELECT m.epi_id FROM public.movimentacoes m
     WHERE m.colaborador_id = p_colaborador_id AND m.organization_id = v_org
  ) AS ids;
  PERFORM public.bloquear_epis_ordenados(v_lock_ids, v_org);

  FOR item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_epi_id := (item ->> 'epi_id')::uuid;
    v_qtd := (item ->> 'quantidade')::integer;

    SELECT e.categoria, e.nome,
           lower(trim(CASE WHEN coalesce(trim(e.tamanho), '') <> ''
                            AND lower(e.nome) LIKE '% ' || lower(trim(e.tamanho))
                           THEN left(e.nome, length(e.nome) - length(trim(e.tamanho)))
                           ELSE e.nome END))
      INTO v_cat, v_nome, v_item
      FROM public.epis e
     WHERE e.id = v_epi_id AND e.organization_id = v_org;
    IF v_nome IS NULL THEN RAISE EXCEPTION 'EPI não encontrado.'; END IF;

    -- Entregas deste mesmo lote não podem virar "EPI anterior" na iteração seguinte.
    -- Trocas já inseridas continuam abatendo o saldo, evitando baixa duplicada do item antigo.
    SELECT s.epi_id, s.saldo, s.epi_nome INTO prev
      FROM (
        SELECT m.epi_id, e.nome AS epi_nome,
               SUM(CASE WHEN m.tipo = 'entrega' THEN m.quantidade
                        WHEN m.tipo IN ('troca', 'devolucao_normal', 'avariado', 'descarte', 'perda', 'roubo')
                        THEN -m.quantidade ELSE 0 END) AS saldo,
               MAX(m.data_movimentacao) FILTER (WHERE m.tipo = 'entrega') AS ultima
          FROM public.movimentacoes m
          JOIN public.epis e ON e.id = m.epi_id AND e.organization_id = m.organization_id
         WHERE m.colaborador_id = p_colaborador_id
           AND m.organization_id = v_org
           AND m.id <> ALL(v_entregas_lote)
           AND lower(trim(CASE WHEN coalesce(trim(e.tamanho), '') <> ''
                                AND lower(e.nome) LIKE '% ' || lower(trim(e.tamanho))
                               THEN left(e.nome, length(e.nome) - length(trim(e.tamanho)))
                               ELSE e.nome END)) = v_item
         GROUP BY m.epi_id, e.nome
      ) s
     WHERE s.saldo > 0
     ORDER BY s.ultima DESC NULLS LAST, s.epi_id
     LIMIT 1;

    v_obs := p_observacao;
    v_troca_id := NULL;

    IF FOUND THEN
      INSERT INTO public.movimentacoes (
        organization_id, tipo, epi_id, colaborador_id, quantidade, motivo,
        observacao, usuario_responsavel, data_movimentacao
      ) VALUES (
        v_org, 'troca', prev.epi_id, p_colaborador_id, LEAST(v_qtd, prev.saldo)::integer,
        'Substituição automática por nova entrega',
        'EPI anterior (' || prev.epi_nome || ') substituído por ' || v_nome,
        p_usuario, p_data_movimentacao
      ) RETURNING id INTO v_troca_id;
    ELSIF EXISTS (
      SELECT 1 FROM public.movimentacoes m
      JOIN public.epis e ON e.id = m.epi_id AND e.organization_id = m.organization_id
       WHERE m.colaborador_id = p_colaborador_id
         AND m.organization_id = v_org
         AND m.id <> ALL(v_entregas_lote)
         AND e.categoria = v_cat AND m.epi_id <> v_epi_id
       GROUP BY m.epi_id
      HAVING SUM(CASE WHEN m.tipo = 'entrega' THEN m.quantidade
                      WHEN m.tipo IN ('troca', 'devolucao_normal', 'avariado', 'descarte', 'perda', 'roubo')
                      THEN -m.quantidade ELSE 0 END) > 0
    ) THEN
      v_obs := trim(coalesce(p_observacao, '') || ' [Inconsistência de troca: nenhum "' || v_nome
               || '" equivalente em posse; outro item da mesma categoria não foi baixado]');
    END IF;

    INSERT INTO public.movimentacoes (
      organization_id, tipo, epi_id, colaborador_id, quantidade, observacao,
      usuario_responsavel, data_movimentacao, movimentacao_vinculada_id
    ) VALUES (
      v_org, 'entrega', v_epi_id, p_colaborador_id, v_qtd, v_obs,
      p_usuario, p_data_movimentacao, v_troca_id
    ) RETURNING id INTO v_entrega_id;

    v_entregas_lote := array_append(v_entregas_lote, v_entrega_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_entrega_atomica(
  p_colaborador_id uuid,
  p_epi_id uuid,
  p_quantidade integer,
  p_observacao text,
  p_data_movimentacao timestamptz,
  p_usuario uuid,
  p_dev_tipo text,
  p_dev_epi_id uuid,
  p_dev_quantidade integer,
  p_dev_motivo text,
  p_dev_observacao text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  v_dev_id uuid;
  v_dev_tipo public.movimentacao_tipo;
BEGIN
  v_org := public.validar_operador_entrega(p_usuario, false);
  IF p_quantidade IS NULL OR p_quantidade < 1 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;
  PERFORM public.bloquear_colaborador(p_colaborador_id, v_org);

  IF p_dev_tipo IS NOT NULL AND p_dev_tipo <> '' AND p_dev_tipo <> 'nenhuma' THEN
    IF p_dev_quantidade IS NULL OR p_dev_quantidade < 1 THEN
      RAISE EXCEPTION 'Quantidade da movimentação anterior deve ser maior que zero.';
    END IF;
    v_dev_tipo := p_dev_tipo::public.movimentacao_tipo;
    IF v_dev_tipo = 'entrega' THEN
      RAISE EXCEPTION 'A movimentação anterior não pode ser outra entrega.';
    END IF;
    PERFORM public.bloquear_epis_ordenados(ARRAY[p_epi_id, p_dev_epi_id], v_org);
    INSERT INTO public.movimentacoes (
      organization_id, tipo, epi_id, colaborador_id, quantidade, motivo,
      observacao, usuario_responsavel, data_movimentacao
    ) VALUES (
      v_org, v_dev_tipo, p_dev_epi_id, p_colaborador_id, p_dev_quantidade,
      p_dev_motivo, p_dev_observacao, p_usuario, p_data_movimentacao
    ) RETURNING id INTO v_dev_id;
  ELSE
    PERFORM public.bloquear_epis_ordenados(ARRAY[p_epi_id], v_org);
  END IF;

  INSERT INTO public.movimentacoes (
    organization_id, tipo, epi_id, colaborador_id, quantidade, observacao,
    usuario_responsavel, data_movimentacao, movimentacao_vinculada_id
  ) VALUES (
    v_org, 'entrega', p_epi_id, p_colaborador_id, p_quantidade, p_observacao,
    p_usuario, p_data_movimentacao, v_dev_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.editar_entrega(
  p_mov_id uuid,
  p_epi_id uuid,
  p_quantidade integer,
  p_data_movimentacao timestamptz,
  p_observacao text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  rec public.movimentacoes%ROWTYPE;
  rec_dev public.movimentacoes%ROWTYPE;
  v_vinculo_inicial uuid;
  v_colaborador_inicial uuid;
  v_epi_inicial uuid;
  disponivel integer;
  v_saldo_base bigint;
  v_nova_troca integer;
BEGIN
  v_org := public.validar_operador_entrega(auth.uid(), true);
  IF p_quantidade IS NULL OR p_quantidade < 1 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  -- Leitura preliminar apenas para descobrir o lock de colaborador.
  SELECT * INTO rec FROM public.movimentacoes
   WHERE id = p_mov_id AND tipo = 'entrega' AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada.'; END IF;
  v_colaborador_inicial := rec.colaborador_id;

  PERFORM public.bloquear_colaborador(v_colaborador_inicial, v_org);

  -- Releitura após o lock do colaborador; ainda sem alterar estoque.
  SELECT * INTO rec FROM public.movimentacoes
   WHERE id = p_mov_id AND tipo = 'entrega' AND organization_id = v_org;
  IF NOT FOUND OR rec.colaborador_id IS DISTINCT FROM v_colaborador_inicial THEN
    RAISE EXCEPTION 'A entrega mudou concorrentemente; operação cancelada.';
  END IF;
  v_vinculo_inicial := rec.movimentacao_vinculada_id;
  v_epi_inicial := rec.epi_id;

  IF v_vinculo_inicial IS NOT NULL THEN
    SELECT * INTO rec_dev FROM public.movimentacoes
     WHERE id = v_vinculo_inicial AND organization_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Movimentação vinculada não encontrada.'; END IF;
    PERFORM public.bloquear_epis_ordenados(ARRAY[v_epi_inicial, p_epi_id, rec_dev.epi_id], v_org);
  ELSE
    PERFORM public.bloquear_epis_ordenados(ARRAY[v_epi_inicial, p_epi_id], v_org);
  END IF;

  -- Locks finais das movimentações e revalidação dos dados usados no cálculo.
  SELECT * INTO rec FROM public.movimentacoes
   WHERE id = p_mov_id AND tipo = 'entrega' AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND OR rec.colaborador_id IS DISTINCT FROM v_colaborador_inicial
     OR rec.epi_id IS DISTINCT FROM v_epi_inicial
     OR rec.movimentacao_vinculada_id IS DISTINCT FROM v_vinculo_inicial THEN
    RAISE EXCEPTION 'A entrega foi alterada concorrentemente; operação cancelada.';
  END IF;
  IF v_vinculo_inicial IS NOT NULL THEN
    SELECT * INTO rec_dev FROM public.movimentacoes
     WHERE id = v_vinculo_inicial AND organization_id = v_org FOR UPDATE;
    IF NOT FOUND OR rec_dev.colaborador_id IS DISTINCT FROM rec.colaborador_id THEN
      RAISE EXCEPTION 'Vínculo alterado concorrentemente; operação cancelada.';
    END IF;
  END IF;

  UPDATE public.epis SET estoque_atual = estoque_atual + rec.quantidade, updated_at = now()
   WHERE id = rec.epi_id AND organization_id = v_org;
  SELECT estoque_atual INTO disponivel FROM public.epis
   WHERE id = p_epi_id AND organization_id = v_org;
  IF disponivel IS NULL THEN RAISE EXCEPTION 'EPI não encontrado.'; END IF;
  IF disponivel < p_quantidade THEN
    RAISE EXCEPTION 'Estoque insuficiente para a alteração. Disponível: %', disponivel;
  END IF;
  UPDATE public.epis SET estoque_atual = estoque_atual - p_quantidade, updated_at = now()
   WHERE id = p_epi_id AND organization_id = v_org;

  UPDATE public.movimentacoes
     SET epi_id = p_epi_id,
         quantidade = p_quantidade,
         data_movimentacao = COALESCE(p_data_movimentacao, data_movimentacao),
         observacao = p_observacao
   WHERE id = p_mov_id AND organization_id = v_org;

  IF rec_dev.id IS NOT NULL THEN
    IF rec_dev.tipo = 'troca' THEN
      -- Recalcula a regra original LEAST(nova entrega, saldo anterior), excluindo
      -- exatamente a entrega e a troca vinculadas; não usa texto ou timestamp como ID.
      SELECT COALESCE(SUM(CASE WHEN m.tipo = 'entrega' THEN m.quantidade
                               WHEN m.tipo IN ('troca', 'devolucao_normal', 'avariado', 'descarte', 'perda', 'roubo')
                               THEN -m.quantidade ELSE 0 END), 0)
        INTO v_saldo_base
        FROM public.movimentacoes m
       WHERE m.organization_id = v_org
         AND m.colaborador_id = rec.colaborador_id
         AND m.epi_id = rec_dev.epi_id
         AND m.id NOT IN (rec.id, rec_dev.id);
      IF v_saldo_base < 1 THEN
        RAISE EXCEPTION 'Saldo anterior insuficiente para preservar a troca vinculada; edição cancelada.';
      END IF;
      v_nova_troca := LEAST(p_quantidade, v_saldo_base)::integer;
      UPDATE public.movimentacoes
         SET quantidade = v_nova_troca,
             data_movimentacao = COALESCE(p_data_movimentacao, data_movimentacao)
       WHERE id = rec_dev.id AND organization_id = v_org;
    ELSE
      UPDATE public.movimentacoes
         SET data_movimentacao = COALESCE(p_data_movimentacao, data_movimentacao)
       WHERE id = rec_dev.id AND organization_id = v_org;
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.excluir_entrega(p_mov_id uuid, p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  rec_entrega public.movimentacoes%ROWTYPE;
  rec_dev public.movimentacoes%ROWTYPE;
  v_vinculo_inicial uuid;
  v_colaborador_inicial uuid;
  v_epi_inicial uuid;
  v_possiveis_legados integer;
BEGIN
  v_org := public.validar_operador_entrega(p_usuario, true);

  SELECT * INTO rec_entrega FROM public.movimentacoes
   WHERE id = p_mov_id AND tipo = 'entrega' AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada'; END IF;
  v_colaborador_inicial := rec_entrega.colaborador_id;

  PERFORM public.bloquear_colaborador(v_colaborador_inicial, v_org);

  SELECT * INTO rec_entrega FROM public.movimentacoes
   WHERE id = p_mov_id AND tipo = 'entrega' AND organization_id = v_org;
  IF NOT FOUND OR rec_entrega.colaborador_id IS DISTINCT FROM v_colaborador_inicial THEN
    RAISE EXCEPTION 'A entrega mudou concorrentemente; operação cancelada.';
  END IF;
  v_vinculo_inicial := rec_entrega.movimentacao_vinculada_id;
  v_epi_inicial := rec_entrega.epi_id;

  IF v_vinculo_inicial IS NOT NULL THEN
    SELECT * INTO rec_dev FROM public.movimentacoes
     WHERE id = v_vinculo_inicial AND organization_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Movimentação vinculada não encontrada.'; END IF;
    PERFORM public.bloquear_epis_ordenados(ARRAY[v_epi_inicial, rec_dev.epi_id], v_org);
  ELSE
    -- Legado: nunca escolhe uma devolução por timestamp/LIMIT 1. Se houver qualquer
    -- candidata, a exclusão é bloqueada para reconciliação explícita; sem candidatas,
    -- a entrega legada pode ser excluída sem inventar um vínculo.
    SELECT count(*) INTO v_possiveis_legados
      FROM public.movimentacoes m
     WHERE m.organization_id = v_org
       AND m.colaborador_id = rec_entrega.colaborador_id
       AND m.data_movimentacao = rec_entrega.data_movimentacao
       AND m.tipo <> 'entrega';
    IF v_possiveis_legados > 0 THEN
      RAISE EXCEPTION 'Entrega legada com possível movimentação vinculada: reconcile o vínculo explícito antes de excluir.';
    END IF;
    PERFORM public.bloquear_epis_ordenados(ARRAY[v_epi_inicial], v_org);
  END IF;

  SELECT * INTO rec_entrega FROM public.movimentacoes
   WHERE id = p_mov_id AND tipo = 'entrega' AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND OR rec_entrega.colaborador_id IS DISTINCT FROM v_colaborador_inicial
     OR rec_entrega.epi_id IS DISTINCT FROM v_epi_inicial
     OR rec_entrega.movimentacao_vinculada_id IS DISTINCT FROM v_vinculo_inicial THEN
    RAISE EXCEPTION 'A entrega foi alterada concorrentemente; operação cancelada.';
  END IF;
  IF v_vinculo_inicial IS NOT NULL THEN
    SELECT * INTO rec_dev FROM public.movimentacoes
     WHERE id = v_vinculo_inicial AND organization_id = v_org FOR UPDATE;
    IF NOT FOUND OR rec_dev.colaborador_id IS DISTINCT FROM rec_entrega.colaborador_id THEN
      RAISE EXCEPTION 'Vínculo alterado concorrentemente; operação cancelada.';
    END IF;
  END IF;

  -- Reverte exatamente os efeitos de aplicar_movimentacao_estoque no INSERT.
  IF rec_dev.id IS NOT NULL THEN
    IF rec_dev.tipo::text IN ('devolucao_normal', 'entrada_estoque', 'ajuste_entrada') THEN
      UPDATE public.epis SET estoque_atual = estoque_atual - rec_dev.quantidade, updated_at = now()
       WHERE id = rec_dev.epi_id AND organization_id = v_org;
    ELSIF rec_dev.tipo::text = 'ajuste_saida' THEN
      UPDATE public.epis SET estoque_atual = estoque_atual + rec_dev.quantidade, updated_at = now()
       WHERE id = rec_dev.epi_id AND organization_id = v_org;
    END IF;
    -- troca/avariado/descarte/perda/roubo: nenhum efeito físico a reverter.
  END IF;
  UPDATE public.epis SET estoque_atual = estoque_atual + rec_entrega.quantidade, updated_at = now()
   WHERE id = rec_entrega.epi_id AND organization_id = v_org;

  -- A entrega referencia a troca; remove primeiro o lado que contém a FK.
  DELETE FROM public.movimentacoes WHERE id = p_mov_id AND organization_id = v_org;
  IF rec_dev.id IS NOT NULL THEN
    DELETE FROM public.movimentacoes WHERE id = rec_dev.id AND organization_id = v_org;
  END IF;
END;
$function$;

-- O frontend já usa as RPCs para escrever movimentações. Bloquear DML direto impede
-- contornar vínculo, reversão de estoque e locks; SELECT e todas as policies originais permanecem.
REVOKE INSERT, UPDATE, DELETE ON public.movimentacoes FROM authenticated, anon;

REVOKE ALL ON FUNCTION public.validar_operador_entrega(uuid, boolean), public.bloquear_colaborador(uuid, uuid), public.bloquear_epis_ordenados(uuid[], uuid), public.validar_vinculo_movimentacao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_entrega_multipla(uuid, jsonb, text, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_entrega_atomica(uuid, uuid, integer, text, timestamptz, uuid, text, uuid, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editar_entrega(uuid, uuid, integer, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excluir_entrega(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_entrega_multipla(uuid, jsonb, text, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_entrega_atomica(uuid, uuid, integer, text, timestamptz, uuid, text, uuid, integer, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_entrega(uuid, uuid, integer, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_entrega(uuid, uuid) TO authenticated, service_role;
