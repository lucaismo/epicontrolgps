CREATE TABLE public.colaborador_tamanhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  item text NOT NULL,
  tamanho text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT colaborador_tamanhos_item_len CHECK (char_length(item) BETWEEN 1 AND 60),
  CONSTRAINT colaborador_tamanhos_tam_len CHECK (char_length(tamanho) BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX colaborador_tamanhos_uniq ON public.colaborador_tamanhos (colaborador_id, lower(item));
CREATE INDEX colaborador_tamanhos_item_idx ON public.colaborador_tamanhos (lower(item), tamanho);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.colaborador_tamanhos TO authenticated;
GRANT ALL ON public.colaborador_tamanhos TO service_role;
ALTER TABLE public.colaborador_tamanhos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuários com perfil veem tamanhos" ON public.colaborador_tamanhos FOR SELECT TO authenticated
USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife') OR app_auth.has_role(auth.uid(),'lider'));
CREATE POLICY "Admin/Técnico/Almoxarife criam tamanhos" ON public.colaborador_tamanhos FOR INSERT TO authenticated
WITH CHECK (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));
CREATE POLICY "Admin/Técnico/Almoxarife editam tamanhos" ON public.colaborador_tamanhos FOR UPDATE TO authenticated
USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));
CREATE POLICY "Admin/Técnico/Almoxarife excluem tamanhos" ON public.colaborador_tamanhos FOR DELETE TO authenticated
USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife'));
CREATE TRIGGER colaborador_tamanhos_updated BEFORE UPDATE ON public.colaborador_tamanhos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();