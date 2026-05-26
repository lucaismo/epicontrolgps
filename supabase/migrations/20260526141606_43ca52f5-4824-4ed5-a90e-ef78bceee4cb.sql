
-- Adiciona 'roubo' ao enum de movimentações
ALTER TYPE movimentacao_tipo ADD VALUE IF NOT EXISTS 'roubo';

-- Ajusta handle_new_user: primeiro = admin, demais ficam SEM role (admin define depois)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  -- Apenas o primeiro usuário (bootstrap) vira admin. Demais ficam sem role até o admin atribuir.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$function$;
