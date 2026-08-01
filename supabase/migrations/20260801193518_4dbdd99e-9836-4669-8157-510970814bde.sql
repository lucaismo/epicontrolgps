DROP POLICY IF EXISTS "Autenticados veem perfis" ON public.profiles;

CREATE POLICY "Usuários veem seu próprio perfil"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR app_auth.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.nomes_responsaveis(p_ids uuid[])
RETURNS TABLE (id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.nome
  FROM public.profiles p
  WHERE p.id = ANY(p_ids)
    AND (
      app_auth.has_role(auth.uid(), 'admin'::app_role)
      OR app_auth.has_role(auth.uid(), 'tecnico'::app_role)
      OR app_auth.has_role(auth.uid(), 'almoxarife'::app_role)
      OR app_auth.has_role(auth.uid(), 'lider'::app_role)
    )
$$;

REVOKE ALL ON FUNCTION public.nomes_responsaveis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomes_responsaveis(uuid[]) TO authenticated;