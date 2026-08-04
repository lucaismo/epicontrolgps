CREATE TABLE public.pedidos_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  epi_id uuid NOT NULL REFERENCES public.epis(id),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  data_pedido timestamp with time zone NOT NULL DEFAULT now(),
  data_prevista date,
  status text NOT NULL DEFAULT 'em_aberto' CHECK (status IN ('em_aberto','recebido')),
  data_recebimento timestamp with time zone,
  observacao text,
  usuario_responsavel uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos_compra TO authenticated;
GRANT ALL ON public.pedidos_compra TO service_role;

ALTER TABLE public.pedidos_compra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários com perfil veem pedidos" ON public.pedidos_compra
FOR SELECT TO authenticated
USING (app_auth.has_role(auth.uid(), 'admin'::app_role) OR app_auth.has_role(auth.uid(), 'tecnico'::app_role) OR app_auth.has_role(auth.uid(), 'almoxarife'::app_role) OR app_auth.has_role(auth.uid(), 'lider'::app_role));

CREATE POLICY "Admin/Técnico/Almoxarife criam pedidos" ON public.pedidos_compra
FOR INSERT TO authenticated
WITH CHECK (app_auth.has_role(auth.uid(), 'admin'::app_role) OR app_auth.has_role(auth.uid(), 'tecnico'::app_role) OR app_auth.has_role(auth.uid(), 'almoxarife'::app_role));

CREATE POLICY "Admin/Técnico/Almoxarife editam pedidos" ON public.pedidos_compra
FOR UPDATE TO authenticated
USING (app_auth.has_role(auth.uid(), 'admin'::app_role) OR app_auth.has_role(auth.uid(), 'tecnico'::app_role) OR app_auth.has_role(auth.uid(), 'almoxarife'::app_role));

CREATE POLICY "Admin exclui pedidos" ON public.pedidos_compra
FOR DELETE TO authenticated
USING (app_auth.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_pedidos_compra_epi_status ON public.pedidos_compra(epi_id, status);

CREATE TRIGGER trg_pedidos_compra_updated BEFORE UPDATE ON public.pedidos_compra
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();