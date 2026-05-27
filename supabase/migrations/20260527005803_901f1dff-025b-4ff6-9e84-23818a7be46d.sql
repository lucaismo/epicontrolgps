
-- 1) Tighten SELECT policies: require an assigned role (not just "authenticated")
DROP POLICY IF EXISTS "Autenticados veem colaboradores" ON public.colaboradores;
CREATE POLICY "Usuários com perfil veem colaboradores" ON public.colaboradores
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tecnico'::app_role)
    OR public.has_role(auth.uid(), 'almoxarife'::app_role)
    OR public.has_role(auth.uid(), 'lider'::app_role)
  );

DROP POLICY IF EXISTS "Autenticados veem EPIs" ON public.epis;
CREATE POLICY "Usuários com perfil veem EPIs" ON public.epis
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tecnico'::app_role)
    OR public.has_role(auth.uid(), 'almoxarife'::app_role)
    OR public.has_role(auth.uid(), 'lider'::app_role)
  );

DROP POLICY IF EXISTS "Autenticados veem movimentações" ON public.movimentacoes;
CREATE POLICY "Usuários com perfil veem movimentações" ON public.movimentacoes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tecnico'::app_role)
    OR public.has_role(auth.uid(), 'almoxarife'::app_role)
    OR public.has_role(auth.uid(), 'lider'::app_role)
  );

DROP POLICY IF EXISTS "Autenticados veem inventários" ON public.inventarios;
CREATE POLICY "Usuários com perfil veem inventários" ON public.inventarios
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tecnico'::app_role)
    OR public.has_role(auth.uid(), 'almoxarife'::app_role)
    OR public.has_role(auth.uid(), 'lider'::app_role)
  );

DROP POLICY IF EXISTS "Autenticados veem itens" ON public.inventario_itens;
CREATE POLICY "Usuários com perfil veem itens" ON public.inventario_itens
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tecnico'::app_role)
    OR public.has_role(auth.uid(), 'almoxarife'::app_role)
    OR public.has_role(auth.uid(), 'lider'::app_role)
  );

-- 2) Restrict EXECUTE on SECURITY DEFINER functions to authenticated only
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;

-- handle_new_user and aplicar_movimentacao_estoque are trigger functions, no client exec needed
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aplicar_movimentacao_estoque() FROM PUBLIC, anon, authenticated;

-- 3) Fix mutable search_path on remaining function
ALTER FUNCTION public.set_updated_at() SET search_path = public;
