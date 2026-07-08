
-- 1) Restringir RPCs sensíveis a admin e revogar de anon/PUBLIC

CREATE OR REPLACE FUNCTION public.excluir_colaborador_seguro(p_colab_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE possui_hist boolean;
BEGIN
  IF NOT app_auth.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta operação.';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.movimentacoes WHERE colaborador_id = p_colab_id) INTO possui_hist;
  IF possui_hist THEN
    UPDATE public.colaboradores SET status = 'desligado', updated_at = now() WHERE id = p_colab_id;
    RETURN 'inativado';
  ELSE
    DELETE FROM public.colaboradores WHERE id = p_colab_id;
    RETURN 'excluido';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.excluir_epi_seguro(p_epi_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE possui_hist boolean; possui_inv boolean;
BEGIN
  IF NOT app_auth.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta operação.';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.movimentacoes WHERE epi_id = p_epi_id) INTO possui_hist;
  SELECT EXISTS(SELECT 1 FROM public.inventario_itens WHERE epi_id = p_epi_id) INTO possui_inv;
  IF possui_hist OR possui_inv THEN
    UPDATE public.epis SET status = 'inativo', updated_at = now() WHERE id = p_epi_id;
    RETURN 'inativado';
  ELSE
    DELETE FROM public.epis WHERE id = p_epi_id;
    RETURN 'excluido';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.excluir_inventario(p_inventario_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st text;
BEGIN
  IF NOT app_auth.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta operação.';
  END IF;
  SELECT status INTO st FROM public.inventarios WHERE id = p_inventario_id;
  IF st IS NULL THEN RAISE EXCEPTION 'Inventário não encontrado'; END IF;
  IF st = 'finalizado' THEN RAISE EXCEPTION 'Inventários finalizados não podem ser excluídos'; END IF;
  DELETE FROM public.inventario_itens WHERE inventario_id = p_inventario_id;
  DELETE FROM public.inventarios WHERE id = p_inventario_id;
END; $$;

-- excluir_entrega já valida admin internamente; mantida a lógica original,
-- apenas endurecendo grants abaixo.

REVOKE EXECUTE ON FUNCTION public.excluir_colaborador_seguro(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.excluir_colaborador_seguro(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.excluir_epi_seguro(uuid)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.excluir_epi_seguro(uuid)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.excluir_inventario(uuid)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.excluir_inventario(uuid)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.excluir_entrega(uuid, uuid)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.excluir_entrega(uuid, uuid)     FROM anon;

GRANT EXECUTE ON FUNCTION public.excluir_colaborador_seguro(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_epi_seguro(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_inventario(uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_entrega(uuid, uuid)     TO authenticated, service_role;

-- 2) Permitir que qualquer autenticado veja perfis (para exibir nome do responsável da entrega)
DROP POLICY IF EXISTS "Usuários veem seu próprio perfil" ON public.profiles;
CREATE POLICY "Autenticados veem perfis" ON public.profiles
  FOR SELECT TO authenticated USING (true);
