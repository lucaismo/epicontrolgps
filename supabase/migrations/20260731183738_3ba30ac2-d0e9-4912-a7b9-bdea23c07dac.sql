-- 1. Código do produto
ALTER TABLE public.epis ADD COLUMN IF NOT EXISTS codigo_produto text;
CREATE INDEX IF NOT EXISTS idx_epis_codigo_produto ON public.epis (codigo_produto);

-- 2. Auditoria
CREATE TABLE IF NOT EXISTS public.auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela text NOT NULL,
  registro_id uuid,
  operacao text NOT NULL,
  usuario_id uuid,
  dados_anteriores jsonb,
  dados_novos jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.auditoria TO authenticated;
GRANT ALL ON public.auditoria TO service_role;

ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin consulta auditoria" ON public.auditoria;
CREATE POLICY "Admin consulta auditoria" ON public.auditoria
  FOR SELECT TO authenticated
  USING (app_auth.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.registrar_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_old := NULL; v_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_new := to_jsonb(NEW); v_old := to_jsonb(OLD); v_id := NEW.id;
    IF v_new = v_old THEN RETURN NEW; END IF;
  ELSE
    v_new := NULL; v_old := to_jsonb(OLD); v_id := OLD.id;
  END IF;

  INSERT INTO public.auditoria (tabela, registro_id, operacao, usuario_id, dados_anteriores, dados_novos)
  VALUES (TG_TABLE_NAME, v_id, TG_OP, auth.uid(), v_old, v_new);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditoria_epis ON public.epis;
CREATE TRIGGER trg_auditoria_epis AFTER INSERT OR UPDATE OR DELETE ON public.epis
  FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_colaboradores ON public.colaboradores;
CREATE TRIGGER trg_auditoria_colaboradores AFTER INSERT OR UPDATE OR DELETE ON public.colaboradores
  FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_movimentacoes ON public.movimentacoes;
CREATE TRIGGER trg_auditoria_movimentacoes AFTER INSERT OR UPDATE OR DELETE ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria_inventarios ON public.inventarios;
CREATE TRIGGER trg_auditoria_inventarios AFTER INSERT OR UPDATE OR DELETE ON public.inventarios
  FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

-- 3. Entrega múltipla (até 5 EPIs, troca automática, transação única)
CREATE OR REPLACE FUNCTION public.registrar_entrega_multipla(
  p_colaborador_id uuid,
  p_itens jsonb,
  p_observacao text,
  p_data_movimentacao timestamptz,
  p_usuario uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  item jsonb;
  v_epi_id uuid;
  v_qtd integer;
  v_cat text;
  v_nome text;
  prev RECORD;
  n integer := 0;
BEGIN
  IF NOT (app_auth.has_role(auth.uid(), 'admin') OR app_auth.has_role(auth.uid(), 'tecnico') OR app_auth.has_role(auth.uid(), 'almoxarife')) THEN
    RAISE EXCEPTION 'Perfil sem permissão para registrar entregas.';
  END IF;
  IF jsonb_array_length(p_itens) < 1 OR jsonb_array_length(p_itens) > 5 THEN
    RAISE EXCEPTION 'Informe de 1 a 5 EPIs por operação.';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_epi_id := (item->>'epi_id')::uuid;
    v_qtd := (item->>'quantidade')::integer;
    IF v_qtd IS NULL OR v_qtd < 1 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

    SELECT categoria, nome INTO v_cat, v_nome FROM public.epis WHERE id = v_epi_id;
    IF v_cat IS NULL THEN RAISE EXCEPTION 'EPI não encontrado.'; END IF;

    -- último EPI ativo da mesma categoria entregue a este colaborador
    SELECT m.id, m.epi_id, m.quantidade, e.nome AS epi_nome
      INTO prev
      FROM public.movimentacoes m
      JOIN public.epis e ON e.id = m.epi_id
     WHERE m.colaborador_id = p_colaborador_id
       AND m.tipo = 'entrega'
       AND e.categoria = v_cat
     ORDER BY m.data_movimentacao DESC
     LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.movimentacoes (tipo, epi_id, colaborador_id, quantidade, motivo, observacao, usuario_responsavel, data_movimentacao)
      VALUES ('troca', prev.epi_id, p_colaborador_id, prev.quantidade,
              'Substituição automática por nova entrega',
              'EPI anterior (' || prev.epi_nome || ') substituído por ' || v_nome,
              p_usuario, p_data_movimentacao);
    END IF;

    INSERT INTO public.movimentacoes (tipo, epi_id, colaborador_id, quantidade, observacao, usuario_responsavel, data_movimentacao)
    VALUES ('entrega', v_epi_id, p_colaborador_id, v_qtd, p_observacao, p_usuario, p_data_movimentacao);

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

-- 4. Editar entrega (admin) com ajuste de estoque
CREATE OR REPLACE FUNCTION public.editar_entrega(
  p_mov_id uuid,
  p_epi_id uuid,
  p_quantidade integer,
  p_data_movimentacao timestamptz,
  p_observacao text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  disponivel integer;
BEGIN
  IF NOT app_auth.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem editar entregas.';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade < 1 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  SELECT * INTO rec FROM public.movimentacoes WHERE id = p_mov_id AND tipo = 'entrega';
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada.'; END IF;

  -- devolve o estoque da entrega original
  UPDATE public.epis SET estoque_atual = estoque_atual + rec.quantidade, updated_at = now() WHERE id = rec.epi_id;

  -- valida e aplica a nova baixa
  SELECT estoque_atual INTO disponivel FROM public.epis WHERE id = p_epi_id FOR UPDATE;
  IF disponivel IS NULL THEN RAISE EXCEPTION 'EPI não encontrado.'; END IF;
  IF disponivel < p_quantidade THEN
    RAISE EXCEPTION 'Estoque insuficiente para a alteração. Disponível: %', disponivel;
  END IF;
  UPDATE public.epis SET estoque_atual = estoque_atual - p_quantidade, updated_at = now() WHERE id = p_epi_id;

  UPDATE public.movimentacoes
     SET epi_id = p_epi_id,
         quantidade = p_quantidade,
         data_movimentacao = COALESCE(p_data_movimentacao, data_movimentacao),
         observacao = p_observacao
   WHERE id = p_mov_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_entrega_multipla(uuid, jsonb, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_entrega_multipla(uuid, jsonb, text, timestamptz, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.editar_entrega(uuid, uuid, integer, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_entrega(uuid, uuid, integer, timestamptz, text) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_auditoria() FROM PUBLIC, anon;
