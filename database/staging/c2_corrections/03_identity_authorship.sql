-- C2.5 / Etapa 3 — identidade e autoria. Somente pelo runner PostgreSQL local descartável.
-- Não mover para migrations automáticas ou aplicar no banco conectado.
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


-- editar_entrega, excluir_entrega e registrar_entrada_estoque já derivam a
-- identidade de auth.uid() (C2.3) e não são alteradas. Grants preservados:
-- CREATE OR REPLACE mantém OID, owner, ACL e proconfig.
CREATE OR REPLACE FUNCTION public.registrar_entrega_multipla(p_colaborador_id uuid, p_itens jsonb, p_observacao text, p_data_movimentacao timestamp with time zone, p_usuario uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  item jsonb;
  v_epi_id uuid;
  v_qtd integer;
  v_cat text;
  v_nome text;
  v_item text;
  v_obs text;
  prev RECORD;
  n integer := 0;
  v_usuario uuid := auth.uid();
BEGIN
  -- C2.5: autoria derivada exclusivamente da sessão; p_usuario é mantido
  -- apenas por compatibilidade de contrato e não é lido.
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Sessão sem usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (app_auth.has_role(v_usuario, 'admin') OR app_auth.has_role(v_usuario, 'tecnico') OR app_auth.has_role(v_usuario, 'almoxarife')) THEN
    RAISE EXCEPTION 'Perfil sem permissão para registrar entregas.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(p_itens) < 1 OR jsonb_array_length(p_itens) > 5 THEN
    RAISE EXCEPTION 'Informe de 1 a 5 EPIs por operação.';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_epi_id := (item->>'epi_id')::uuid;
    v_qtd := (item->>'quantidade')::integer;
    IF v_qtd IS NULL OR v_qtd < 1 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

    -- item-base = nome do EPI sem o sufixo de tamanho (ex.: "Camisa M" -> "camisa")
    SELECT e.categoria, e.nome,
           lower(trim(CASE WHEN coalesce(trim(e.tamanho),'') <> '' AND lower(e.nome) LIKE '% ' || lower(trim(e.tamanho))
                           THEN left(e.nome, length(e.nome) - length(trim(e.tamanho))) ELSE e.nome END))
      INTO v_cat, v_nome, v_item
      FROM public.epis e WHERE e.id = v_epi_id;
    IF v_nome IS NULL THEN RAISE EXCEPTION 'EPI não encontrado.'; END IF;

    -- EPI do MESMO ITEM (qualquer tamanho) com saldo em posse do colaborador; categoria não é critério
    SELECT s.epi_id, s.saldo, s.epi_nome INTO prev
      FROM (
        SELECT m.epi_id, e.nome AS epi_nome,
               SUM(CASE WHEN m.tipo = 'entrega' THEN m.quantidade
                        WHEN m.tipo IN ('troca','devolucao_normal','avariado','descarte','perda','roubo') THEN -m.quantidade
                        ELSE 0 END) AS saldo,
               MAX(m.data_movimentacao) FILTER (WHERE m.tipo = 'entrega') AS ultima
          FROM public.movimentacoes m
          JOIN public.epis e ON e.id = m.epi_id
         WHERE m.colaborador_id = p_colaborador_id
           AND lower(trim(CASE WHEN coalesce(trim(e.tamanho),'') <> '' AND lower(e.nome) LIKE '% ' || lower(trim(e.tamanho))
                               THEN left(e.nome, length(e.nome) - length(trim(e.tamanho))) ELSE e.nome END)) = v_item
         GROUP BY m.epi_id, e.nome
      ) s
     WHERE s.saldo > 0
     ORDER BY s.ultima DESC NULLS LAST
     LIMIT 1;

    v_obs := p_observacao;

    IF FOUND THEN
      INSERT INTO public.movimentacoes (tipo, epi_id, colaborador_id, quantidade, motivo, observacao, usuario_responsavel, data_movimentacao)
      VALUES ('troca', prev.epi_id, p_colaborador_id, LEAST(v_qtd, prev.saldo)::integer,
              'Substituição automática por nova entrega',
              'EPI anterior (' || prev.epi_nome || ') substituído por ' || v_nome,
              v_usuario, p_data_movimentacao);
    ELSIF EXISTS (
      -- sinaliza: há outro item da mesma categoria em posse, mas NÃO foi baixado
      SELECT 1 FROM public.movimentacoes m JOIN public.epis e ON e.id = m.epi_id
       WHERE m.colaborador_id = p_colaborador_id AND e.categoria = v_cat AND m.epi_id <> v_epi_id
       GROUP BY m.epi_id
      HAVING SUM(CASE WHEN m.tipo = 'entrega' THEN m.quantidade
                      WHEN m.tipo IN ('troca','devolucao_normal','avariado','descarte','perda','roubo') THEN -m.quantidade
                      ELSE 0 END) > 0
    ) THEN
      v_obs := trim(coalesce(p_observacao,'') || ' [Inconsistência de troca: nenhum "' || v_nome
               || '" equivalente em posse; outro item da mesma categoria não foi baixado]');
    END IF;

    INSERT INTO public.movimentacoes (tipo, epi_id, colaborador_id, quantidade, observacao, usuario_responsavel, data_movimentacao)
    VALUES ('entrega', v_epi_id, p_colaborador_id, v_qtd, v_obs, v_usuario, p_data_movimentacao);

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

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
  v_usuario uuid := auth.uid();
BEGIN
  -- C2.5: autorização e autoria pela sessão; p_usuario ignorado.
  -- Idempotência/concorrência pertencem à Etapa 4 e não são tratadas aqui.
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Sessão sem usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (app_auth.has_role(v_usuario, 'admin') OR app_auth.has_role(v_usuario, 'tecnico') OR app_auth.has_role(v_usuario, 'almoxarife')) THEN
    RAISE EXCEPTION 'Perfil sem permissão para finalizar inventários.' USING ERRCODE = '42501';
  END IF;

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
              'Ajuste de inventário', 'Inventário "' || inv_local || '"', v_usuario);
    ELSIF diff < 0 THEN
      INSERT INTO public.movimentacoes (tipo, epi_id, quantidade, motivo, observacao, usuario_responsavel)
      VALUES ('ajuste_saida', rec.epi_id, -diff,
              'Ajuste de inventário', 'Inventário "' || inv_local || '"', v_usuario);
    END IF;
  END LOOP;

  UPDATE public.inventarios
  SET status = 'finalizado', data_fim = now()
  WHERE id = p_inventario_id;
END;
$$;
COMMIT;
