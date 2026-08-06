CREATE TABLE public.compras_ajustes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  epi_id uuid NOT NULL REFERENCES public.epis(id) ON DELETE CASCADE,
  ano integer NOT NULL,
  mes integer NOT NULL,
  quantidade integer NOT NULL DEFAULT 0,
  sugestao_registrada integer NOT NULL DEFAULT 0,
  usuario_responsavel uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (epi_id, ano, mes)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compras_ajustes TO authenticated;
GRANT ALL ON public.compras_ajustes TO service_role;

ALTER TABLE public.compras_ajustes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários com perfil veem ajustes de compras"
ON public.compras_ajustes FOR SELECT TO authenticated
USING (app_auth.has_role(auth.uid(), 'admin'::app_role) OR app_auth.has_role(auth.uid(), 'tecnico'::app_role) OR app_auth.has_role(auth.uid(), 'almoxarife'::app_role) OR app_auth.has_role(auth.uid(), 'lider'::app_role));

CREATE POLICY "Admin/Técnico/Almoxarife criam ajustes de compras"
ON public.compras_ajustes FOR INSERT TO authenticated
WITH CHECK (app_auth.has_role(auth.uid(), 'admin'::app_role) OR app_auth.has_role(auth.uid(), 'tecnico'::app_role) OR app_auth.has_role(auth.uid(), 'almoxarife'::app_role));

CREATE POLICY "Admin/Técnico/Almoxarife editam ajustes de compras"
ON public.compras_ajustes FOR UPDATE TO authenticated
USING (app_auth.has_role(auth.uid(), 'admin'::app_role) OR app_auth.has_role(auth.uid(), 'tecnico'::app_role) OR app_auth.has_role(auth.uid(), 'almoxarife'::app_role));

CREATE POLICY "Admin exclui ajustes de compras"
ON public.compras_ajustes FOR DELETE TO authenticated
USING (app_auth.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_compras_ajustes_updated_at
BEFORE UPDATE ON public.compras_ajustes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();