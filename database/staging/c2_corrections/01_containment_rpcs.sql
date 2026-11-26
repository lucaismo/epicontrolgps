-- C2.3 / Etapa 1. EXCLUSIVAMENTE PostgreSQL local descartável.
-- Não mover para diretórios de migrations automáticas. Não aplicar em Cloud.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'epi_c2_staging'
     OR current_setting('port') <> '55433'
     OR current_setting('data_directory') <> '/tmp/epi-c2-pg/data'
     OR inet_server_addr() IS NOT NULL
     OR current_setting('unix_socket_directories') <> '/tmp/epi-c2-pg'
     OR current_setting('listen_addresses') <> '' THEN
    RAISE EXCEPTION 'C2: conexão fora da lista de permissões local';
  END IF;
END;
$$;

-- PUBLIC também é removido para impedir EXECUTE herdado; service_role é preservado.
REVOKE EXECUTE ON FUNCTION public.registrar_entrega_atomica(
  uuid, uuid, integer, text, timestamptz, uuid, text, uuid, integer, text, text
) FROM PUBLIC, authenticated, anon;

-- Só muda a autorização: seleção legada por timestamp/LIMIT 1 permanece intacta.
-- Referência histórica a devolucao_normal é preservada, não criada nem reinserida.
CREATE OR REPLACE FUNCTION public.excluir_entrega(p_mov_id uuid, p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario uuid := auth.uid();
  rec_entrega RECORD;
  rec_dev RECORD;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(app_auth.has_role(v_usuario, 'admin'), false) THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir entregas' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO rec_entrega FROM public.movimentacoes WHERE id = p_mov_id AND tipo = 'entrega';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega não encontrada';
  END IF;

  -- Devolução vinculada (mesma colaborador + mesma data_movimentacao) — inclui substituição automática
  SELECT * INTO rec_dev FROM public.movimentacoes
   WHERE colaborador_id = rec_entrega.colaborador_id
     AND data_movimentacao = rec_entrega.data_movimentacao
     AND tipo <> 'entrega'
   LIMIT 1;

  IF FOUND THEN
    -- reverter efeito da devolução vinculada no estoque
    IF rec_dev.tipo::text IN ('devolucao_normal', 'ajuste_entrada') THEN
      UPDATE public.epis SET estoque_atual = estoque_atual - rec_dev.quantidade, updated_at = now()
        WHERE id = rec_dev.epi_id;
    ELSIF rec_dev.tipo::text = 'ajuste_saida' THEN
      UPDATE public.epis SET estoque_atual = estoque_atual + rec_dev.quantidade, updated_at = now()
        WHERE id = rec_dev.epi_id;
    END IF;
    -- perda/roubo/avariado/descarte/troca não alteraram estoque na origem (já saiu na entrega)
    DELETE FROM public.movimentacoes WHERE id = rec_dev.id;
  END IF;

  -- reverter a entrega (devolver ao estoque)
  UPDATE public.epis SET estoque_atual = estoque_atual + rec_entrega.quantidade, updated_at = now()
    WHERE id = rec_entrega.epi_id;
  DELETE FROM public.movimentacoes WHERE id = p_mov_id;
END;
$$;


-- Contrato do frontend preservado (inclui p_usuario); identidade vem da sessão.
CREATE OR REPLACE FUNCTION public.registrar_entrada_estoque(
  p_epi_id uuid,
  p_quantidade integer,
  p_motivo text,
  p_observacao text,
  p_usuario uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(app_auth.has_role(v_usuario, 'admin'), false)
          OR COALESCE(app_auth.has_role(v_usuario, 'tecnico'), false)
          OR COALESCE(app_auth.has_role(v_usuario, 'almoxarife'), false)) THEN
    RAISE EXCEPTION 'Perfil sem permissão para registrar entrada de estoque' USING ERRCODE = '42501';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero';
  END IF;
  INSERT INTO public.movimentacoes (tipo, epi_id, quantidade, motivo, observacao, usuario_responsavel)
    VALUES ('entrada_estoque', p_epi_id, p_quantidade, p_motivo, p_observacao, v_usuario);
END;
$$;
COMMIT;
