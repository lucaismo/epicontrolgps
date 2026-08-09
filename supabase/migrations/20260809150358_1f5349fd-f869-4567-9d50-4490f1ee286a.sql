ALTER TABLE public.movimentacoes DROP CONSTRAINT movimentacoes_usuario_responsavel_fkey;
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_usuario_responsavel_fkey FOREIGN KEY (usuario_responsavel) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.inventarios DROP CONSTRAINT inventarios_responsavel_fkey;
ALTER TABLE public.inventarios ADD CONSTRAINT inventarios_responsavel_fkey FOREIGN KEY (responsavel) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pedidos_compra DROP CONSTRAINT pedidos_compra_usuario_responsavel_fkey;
ALTER TABLE public.pedidos_compra ADD CONSTRAINT pedidos_compra_usuario_responsavel_fkey FOREIGN KEY (usuario_responsavel) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.compras_ajustes DROP CONSTRAINT compras_ajustes_usuario_responsavel_fkey;
ALTER TABLE public.compras_ajustes ADD CONSTRAINT compras_ajustes_usuario_responsavel_fkey FOREIGN KEY (usuario_responsavel) REFERENCES auth.users(id) ON DELETE SET NULL;