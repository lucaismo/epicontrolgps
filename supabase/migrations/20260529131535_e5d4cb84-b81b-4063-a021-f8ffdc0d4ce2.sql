ALTER TABLE public.colaboradores DROP COLUMN IF EXISTS setor;
ALTER TABLE public.colaboradores DROP COLUMN IF EXISTS gestor;
ALTER TABLE public.colaboradores ADD CONSTRAINT colaboradores_matricula_unique UNIQUE (matricula);