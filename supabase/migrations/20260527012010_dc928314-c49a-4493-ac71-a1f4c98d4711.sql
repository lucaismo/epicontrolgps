
-- 1) Schema privado, não exposto pela Data API
CREATE SCHEMA IF NOT EXISTS app_auth;
REVOKE ALL ON SCHEMA app_auth FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_auth TO authenticated, service_role;

-- 2) Recriar funções no schema privado
CREATE OR REPLACE FUNCTION app_auth.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION app_auth.get_user_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'tecnico' THEN 2
    WHEN 'almoxarife' THEN 3
    WHEN 'lider' THEN 4
  END LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION app_auth.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION app_auth.get_user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_auth.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_auth.get_user_role(uuid) TO authenticated, service_role;

-- 3) Recriar políticas referenciando app_auth.has_role

-- profiles
DROP POLICY IF EXISTS "Usuários veem seu próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin vê tudo profiles" ON public.profiles;
CREATE POLICY "Usuários veem seu próprio perfil" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR app_auth.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin vê tudo profiles" ON public.profiles FOR ALL TO authenticated USING (app_auth.has_role(auth.uid(), 'admin'));

-- user_roles
DROP POLICY IF EXISTS "Usuários veem seus papéis" ON public.user_roles;
DROP POLICY IF EXISTS "Admin gerencia papéis" ON public.user_roles;
CREATE POLICY "Usuários veem seus papéis" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR app_auth.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin gerencia papéis" ON public.user_roles FOR ALL TO authenticated USING (app_auth.has_role(auth.uid(), 'admin')) WITH CHECK (app_auth.has_role(auth.uid(), 'admin'));

-- colaboradores
DROP POLICY IF EXISTS "Usuários com perfil veem colaboradores" ON public.colaboradores;
DROP POLICY IF EXISTS "Admin/Técnico criam colaboradores" ON public.colaboradores;
DROP POLICY IF EXISTS "Admin/Técnico editam colaboradores" ON public.colaboradores;
DROP POLICY IF EXISTS "Admin exclui colaboradores" ON public.colaboradores;
CREATE POLICY "Usuários com perfil veem colaboradores" ON public.colaboradores FOR SELECT TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife') OR app_auth.has_role(auth.uid(),'lider'));
CREATE POLICY "Admin/Técnico criam colaboradores" ON public.colaboradores FOR INSERT TO authenticated WITH CHECK (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico'));
CREATE POLICY "Admin/Técnico editam colaboradores" ON public.colaboradores FOR UPDATE TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico'));
CREATE POLICY "Admin exclui colaboradores" ON public.colaboradores FOR DELETE TO authenticated USING (app_auth.has_role(auth.uid(),'admin'));

-- epis
DROP POLICY IF EXISTS "Usuários com perfil veem EPIs" ON public.epis;
DROP POLICY IF EXISTS "Admin/Técnico criam EPIs" ON public.epis;
DROP POLICY IF EXISTS "Admin/Técnico/Almoxarife editam EPIs" ON public.epis;
DROP POLICY IF EXISTS "Admin exclui EPIs" ON public.epis;
CREATE POLICY "Usuários com perfil veem EPIs" ON public.epis FOR SELECT TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife') OR app_auth.has_role(auth.uid(),'lider'));
CREATE POLICY "Admin/Técnico criam EPIs" ON public.epis FOR INSERT TO authenticated WITH CHECK (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico'));
CREATE POLICY "Admin/Técnico/Almoxarife editam EPIs" ON public.epis FOR UPDATE TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));
CREATE POLICY "Admin exclui EPIs" ON public.epis FOR DELETE TO authenticated USING (app_auth.has_role(auth.uid(),'admin'));

-- movimentacoes
DROP POLICY IF EXISTS "Usuários com perfil veem movimentações" ON public.movimentacoes;
DROP POLICY IF EXISTS "Admin/Técnico/Almoxarife registram movimentações" ON public.movimentacoes;
DROP POLICY IF EXISTS "Admin exclui movimentações" ON public.movimentacoes;
CREATE POLICY "Usuários com perfil veem movimentações" ON public.movimentacoes FOR SELECT TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife') OR app_auth.has_role(auth.uid(),'lider'));
CREATE POLICY "Admin/Técnico/Almoxarife registram movimentações" ON public.movimentacoes FOR INSERT TO authenticated WITH CHECK (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));
CREATE POLICY "Admin exclui movimentações" ON public.movimentacoes FOR DELETE TO authenticated USING (app_auth.has_role(auth.uid(),'admin'));

-- inventarios
DROP POLICY IF EXISTS "Usuários com perfil veem inventários" ON public.inventarios;
DROP POLICY IF EXISTS "Admin/Técnico/Almoxarife criam inventários" ON public.inventarios;
DROP POLICY IF EXISTS "Admin/Técnico/Almoxarife editam inventários" ON public.inventarios;
DROP POLICY IF EXISTS "Admin exclui inventários" ON public.inventarios;
CREATE POLICY "Usuários com perfil veem inventários" ON public.inventarios FOR SELECT TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife') OR app_auth.has_role(auth.uid(),'lider'));
CREATE POLICY "Admin/Técnico/Almoxarife criam inventários" ON public.inventarios FOR INSERT TO authenticated WITH CHECK (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));
CREATE POLICY "Admin/Técnico/Almoxarife editam inventários" ON public.inventarios FOR UPDATE TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));
CREATE POLICY "Admin exclui inventários" ON public.inventarios FOR DELETE TO authenticated USING (app_auth.has_role(auth.uid(),'admin'));

-- inventario_itens
DROP POLICY IF EXISTS "Usuários com perfil veem itens" ON public.inventario_itens;
DROP POLICY IF EXISTS "Admin/Técnico/Almoxarife gerenciam itens" ON public.inventario_itens;
CREATE POLICY "Usuários com perfil veem itens" ON public.inventario_itens FOR SELECT TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife') OR app_auth.has_role(auth.uid(),'lider'));
CREATE POLICY "Admin/Técnico/Almoxarife gerenciam itens" ON public.inventario_itens FOR ALL TO authenticated USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife')) WITH CHECK (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));

-- 4) Remover funções públicas (não mais usadas por nenhuma policy)
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.get_user_role(uuid);
