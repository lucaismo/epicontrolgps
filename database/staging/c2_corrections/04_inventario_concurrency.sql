-- C2.6 / Etapa 4 — integridade transacional e concorrência do inventário.
-- Somente pelo runner PostgreSQL local descartável. Não mover para migrations
-- automáticas nem aplicar no banco conectado.
--
-- Ordem canônica de locks (todos os caminhos):
--   escrita de item (frontend/autosave): linha do item -> cabeçalho FOR SHARE (trigger)
--   excluir_inventario: itens FOR UPDATE (ordem id) -> cabeçalho FOR UPDATE
--   finalizar_inventario: cabeçalho FOR UPDATE -> EPIs divergentes FOR UPDATE (ordem UUID)
-- finalizar não trava itens: toda escrita de item exige FOR SHARE no cabeçalho, que
-- conflita com o FOR UPDATE da finalização; assim não há ciclo item<->cabeçalho.
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

-- 1. Sentinela de status do cabeçalho para INSERT/UPDATE/DELETE de itens.
-- SECURITY DEFINER: o FOR SHARE no cabeçalho não depende de grants/RLS do chamador;
-- a autorização da escrita do item continua sendo a RLS de inventario_itens.
CREATE OR REPLACE FUNCTION public.trg_validar_inventario_item_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_status public.inventario_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.inventario_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.inventario_id];
  ELSIF NEW.inventario_id IS DISTINCT FROM OLD.inventario_id THEN
    -- Transferência: os dois cabeçalhos em ordem canônica de UUID.
    v_ids := ARRAY(SELECT x FROM unnest(ARRAY[OLD.inventario_id, NEW.inventario_id]) x ORDER BY x);
  ELSE
    v_ids := ARRAY[NEW.inventario_id];
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT i.status INTO v_status FROM public.inventarios i WHERE i.id = v_id FOR SHARE;
    IF NOT FOUND THEN
      -- DELETE em cascata a partir do próprio cabeçalho: ele já foi removido nesta transação.
      IF TG_OP = 'DELETE' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Inventário não encontrado' USING ERRCODE = '23503';
    END IF;
    IF v_status = 'finalizado' THEN
      RAISE EXCEPTION 'Inventário finalizado não aceita alterações de itens.' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_validar_inventario_item_status() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_validar_inventario_item_status ON public.inventario_itens;
CREATE TRIGGER trg_validar_inventario_item_status
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventario_itens
  FOR EACH ROW EXECUTE FUNCTION public.trg_validar_inventario_item_status();

-- 2. finalizar_inventario: contrato, autorização e autoria da C2.5 preservados.
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
  inv_status public.inventario_status;
  v_usuario uuid := auth.uid();
BEGIN
  -- p_usuario mantido apenas por compatibilidade; não é lido.
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Sessão sem usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (app_auth.has_role(v_usuario, 'admin') OR app_auth.has_role(v_usuario, 'tecnico') OR app_auth.has_role(v_usuario, 'almoxarife')) THEN
    RAISE EXCEPTION 'Perfil sem permissão para finalizar inventários.' USING ERRCODE = '42501';
  END IF;

  -- Existência pelo FOUND do lock, não por inv_local IS NULL.
  SELECT i.local, i.status INTO inv_local, inv_status
  FROM public.inventarios i WHERE i.id = p_inventario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF inv_status = 'finalizado' THEN
    RAISE EXCEPTION 'Inventário já finalizado.' USING ERRCODE = '22000';
  END IF;

  -- EPIs divergentes travados em ordem canônica antes de qualquer movimentação.
  PERFORM 1 FROM public.epis e
  WHERE e.id IN (SELECT it.epi_id FROM public.inventario_itens it
                 WHERE it.inventario_id = p_inventario_id
                   AND it.quantidade_contada IS NOT NULL
                   AND it.quantidade_contada <> it.quantidade_sistema)
  ORDER BY e.id FOR UPDATE;

  FOR rec IN
    SELECT it.epi_id, it.quantidade_sistema, it.quantidade_contada
    FROM public.inventario_itens it
    WHERE it.inventario_id = p_inventario_id AND it.quantidade_contada IS NOT NULL
    ORDER BY it.epi_id
  LOOP
    diff := rec.quantidade_contada - rec.quantidade_sistema;
    IF diff > 0 THEN
      INSERT INTO public.movimentacoes (tipo, epi_id, quantidade, motivo, observacao, usuario_responsavel)
      VALUES ('ajuste_entrada', rec.epi_id, diff,
              'Ajuste de inventário', 'Inventário "' || inv_local || '"', v_usuario);
    ELSIF diff < 0 THEN
      INSERT INTO public.movimentacoes (tipo, epi_id, quantidade, motivo, observacao, usuario_responsavel)
      VALUES ('ajuste_saida', rec.epi_id, -diff,
              'Ajuste de inventário', 'Inventário "' || inv_local || '"', v_usuario);
    END IF;
  END LOOP;

  UPDATE public.inventarios SET status = 'finalizado', data_fim = now()
  WHERE id = p_inventario_id;
END;
$$;

-- 3. excluir_inventario: somente admin; itens antes do cabeçalho (mesma ordem do autosave).
CREATE OR REPLACE FUNCTION public.excluir_inventario(p_inventario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  st public.inventario_status;
BEGIN
  IF auth.uid() IS NULL OR NOT app_auth.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta operação.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.inventario_itens it
  WHERE it.inventario_id = p_inventario_id ORDER BY it.id FOR UPDATE;
  SELECT i.status INTO st FROM public.inventarios i WHERE i.id = p_inventario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventário não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF st = 'finalizado' THEN
    RAISE EXCEPTION 'Inventários finalizados não podem ser excluídos' USING ERRCODE = '22000';
  END IF;
  DELETE FROM public.inventario_itens WHERE inventario_id = p_inventario_id;
  DELETE FROM public.inventarios WHERE id = p_inventario_id;
END;
$$;
COMMIT;
