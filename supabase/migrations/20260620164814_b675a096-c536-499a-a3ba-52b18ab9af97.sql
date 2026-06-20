-- Padronizar matrículas para 6 dígitos com zeros à esquerda
UPDATE public.colaboradores
SET matricula = LPAD(regexp_replace(matricula, '\D', '', 'g'), 6, '0')
WHERE matricula !~ '^[0-9]{6}$';

ALTER TABLE public.colaboradores
  DROP CONSTRAINT IF EXISTS colaboradores_matricula_formato_chk;

ALTER TABLE public.colaboradores
  ADD CONSTRAINT colaboradores_matricula_formato_chk
  CHECK (matricula ~ '^[0-9]{6}$');