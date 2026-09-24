ALTER TABLE public.inventarios ALTER COLUMN local DROP NOT NULL;
ALTER TABLE public.inventarios ADD COLUMN IF NOT EXISTS descricao text;