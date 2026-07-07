
-- Excluir colaborador seguro
CREATE OR REPLACE FUNCTION public.excluir_colaborador_seguro(p_colab_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  possui_hist boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.movimentacoes WHERE colaborador_id = p_colab_id) INTO possui_hist;
  IF possui_hist THEN
    UPDATE public.colaboradores SET status = 'desligado', updated_at = now() WHERE id = p_colab_id;
    RETURN 'inativado';
  ELSE
    DELETE FROM public.colaboradores WHERE id = p_colab_id;
    RETURN 'excluido';
  END IF;
END;
$$;

-- Excluir EPI seguro
CREATE OR REPLACE FUNCTION public.excluir_epi_seguro(p_epi_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  possui_hist boolean;
  possui_inv boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.movimentacoes WHERE epi_id = p_epi_id) INTO possui_hist;
  SELECT EXISTS(SELECT 1 FROM public.inventario_itens WHERE epi_id = p_epi_id) INTO possui_inv;
  IF possui_hist OR possui_inv THEN
    UPDATE public.epis SET status = 'inativo', updated_at = now() WHERE id = p_epi_id;
    RETURN 'inativado';
  ELSE
    DELETE FROM public.epis WHERE id = p_epi_id;
    RETURN 'excluido';
  END IF;
END;
$$;

-- Excluir entrega (admin) — reverte estoque e remove devolução vinculada
CREATE OR REPLACE FUNCTION public.excluir_entrega(p_mov_id uuid, p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eh_admin boolean;
  rec_entrega RECORD;
  rec_dev RECORD;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = p_usuario AND role = 'admin') INTO eh_admin;
  IF NOT eh_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir entregas';
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

-- Excluir inventário — só se não finalizado
CREATE OR REPLACE FUNCTION public.excluir_inventario(p_inventario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM public.inventarios WHERE id = p_inventario_id;
  IF st IS NULL THEN
    RAISE EXCEPTION 'Inventário não encontrado';
  END IF;
  IF st = 'finalizado' THEN
    RAISE EXCEPTION 'Inventários finalizados não podem ser excluídos';
  END IF;
  DELETE FROM public.inventario_itens WHERE inventario_id = p_inventario_id;
  DELETE FROM public.inventarios WHERE id = p_inventario_id;
END;
$$;
