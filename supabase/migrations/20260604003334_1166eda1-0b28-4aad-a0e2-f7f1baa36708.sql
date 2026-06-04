
-- 1. Novos tipos de movimentação
ALTER TYPE public.movimentacao_tipo ADD VALUE IF NOT EXISTS 'ajuste_entrada';
ALTER TYPE public.movimentacao_tipo ADD VALUE IF NOT EXISTS 'ajuste_saida';

-- 2. Atualiza trigger de estoque para tratar ajustes (usa cast para texto para evitar erro de enum recém-criado)
CREATE OR REPLACE FUNCTION public.aplicar_movimentacao_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  estoque_atual_val INTEGER;
  t TEXT := NEW.tipo::text;
BEGIN
  SELECT estoque_atual INTO estoque_atual_val FROM public.epis WHERE id = NEW.epi_id FOR UPDATE;

  IF t = 'entrega' THEN
    IF estoque_atual_val < NEW.quantidade THEN
      RAISE EXCEPTION 'Estoque insuficiente. Disponível: %', estoque_atual_val;
    END IF;
    UPDATE public.epis SET estoque_atual = estoque_atual - NEW.quantidade, updated_at = now() WHERE id = NEW.epi_id;
  ELSIF t IN ('devolucao_normal', 'entrada_estoque', 'ajuste_entrada') THEN
    UPDATE public.epis SET estoque_atual = estoque_atual + NEW.quantidade, updated_at = now() WHERE id = NEW.epi_id;
  ELSIF t = 'ajuste_saida' THEN
    IF estoque_atual_val < NEW.quantidade THEN
      RAISE EXCEPTION 'Ajuste de saída maior que o estoque disponível (%).', estoque_atual_val;
    END IF;
    UPDATE public.epis SET estoque_atual = estoque_atual - NEW.quantidade, updated_at = now() WHERE id = NEW.epi_id;
  END IF;
  -- avariado, descarte, perda, roubo, troca: sem alteração de estoque (já saíram na entrega)
  RETURN NEW;
END;
$function$;

-- 3. RPC: entrega + devolução numa transação única (C3)
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
SET search_path TO 'public'
AS $$
BEGIN
  -- registra devolução primeiro, se houver. Tudo dentro da mesma transação:
  -- se a entrega falhar, ROLLBACK desfaz também a devolução.
  IF p_dev_tipo IS NOT NULL AND p_dev_tipo <> '' AND p_dev_tipo <> 'nenhuma' THEN
    INSERT INTO public.movimentacoes (tipo, epi_id, colaborador_id, quantidade, motivo, observacao, usuario_responsavel, data_movimentacao)
    VALUES (p_dev_tipo::public.movimentacao_tipo, p_dev_epi_id, p_colaborador_id, p_dev_quantidade,
            p_dev_motivo, p_dev_observacao, p_usuario, p_data_movimentacao);
  END IF;

  INSERT INTO public.movimentacoes (tipo, epi_id, colaborador_id, quantidade, observacao, usuario_responsavel, data_movimentacao)
  VALUES ('entrega', p_epi_id, p_colaborador_id, p_quantidade, p_observacao, p_usuario, p_data_movimentacao);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_entrega_atomica(uuid, uuid, integer, text, timestamptz, uuid, text, uuid, integer, text, text) TO authenticated;

-- 4. RPC: finaliza inventário aplicando ajustes (C1)
CREATE OR REPLACE FUNCTION public.finalizar_inventario(p_inventario_id uuid, p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  diff INTEGER;
  inv_local TEXT;
BEGIN
  SELECT local INTO inv_local FROM public.inventarios WHERE id = p_inventario_id;
  IF inv_local IS NULL THEN
    RAISE EXCEPTION 'Inventário não encontrado';
  END IF;

  FOR rec IN
    SELECT id, epi_id, quantidade_sistema, quantidade_contada
    FROM public.inventario_itens
    WHERE inventario_id = p_inventario_id AND quantidade_contada IS NOT NULL
  LOOP
    diff := rec.quantidade_contada - rec.quantidade_sistema;
    IF diff > 0 THEN
      INSERT INTO public.movimentacoes (tipo, epi_id, quantidade, motivo, observacao, usuario_responsavel)
      VALUES ('ajuste_entrada', rec.epi_id, diff,
              'Ajuste de inventário', 'Inventário "' || inv_local || '"', p_usuario);
    ELSIF diff < 0 THEN
      INSERT INTO public.movimentacoes (tipo, epi_id, quantidade, motivo, observacao, usuario_responsavel)
      VALUES ('ajuste_saida', rec.epi_id, -diff,
              'Ajuste de inventário', 'Inventário "' || inv_local || '"', p_usuario);
    END IF;
  END LOOP;

  UPDATE public.inventarios
  SET status = 'finalizado', data_fim = now()
  WHERE id = p_inventario_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalizar_inventario(uuid, uuid) TO authenticated;

-- 5. RPC: entrada de estoque rastreável (A1/A4)
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
BEGIN
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero';
  END IF;
  INSERT INTO public.movimentacoes (tipo, epi_id, quantidade, motivo, observacao, usuario_responsavel)
  VALUES ('entrada_estoque', p_epi_id, p_quantidade, p_motivo, p_observacao, p_usuario);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_entrada_estoque(uuid, integer, text, text, uuid) TO authenticated;
