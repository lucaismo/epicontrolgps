ALTER TABLE public.epis ADD COLUMN IF NOT EXISTS dias_seguranca integer NOT NULL DEFAULT 20;

CREATE TABLE IF NOT EXISTS public.compras_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  dia_pedido integer NOT NULL DEFAULT 20,
  dia_recebimento integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.compras_config TO authenticated;
GRANT ALL ON public.compras_config TO service_role;

ALTER TABLE public.compras_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários com perfil veem config de compras" ON public.compras_config
FOR SELECT TO authenticated
USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico') OR app_auth.has_role(auth.uid(),'almoxarife') OR app_auth.has_role(auth.uid(),'lider'));

CREATE POLICY "Admin/Técnico criam config de compras" ON public.compras_config
FOR INSERT TO authenticated
WITH CHECK (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico'));

CREATE POLICY "Admin/Técnico editam config de compras" ON public.compras_config
FOR UPDATE TO authenticated
USING (app_auth.has_role(auth.uid(),'admin') OR app_auth.has_role(auth.uid(),'tecnico'));

CREATE TRIGGER trg_compras_config_updated BEFORE UPDATE ON public.compras_config
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.compras_config (singleton, dia_pedido, dia_recebimento)
VALUES (true, 20, 10) ON CONFLICT (singleton) DO NOTHING;