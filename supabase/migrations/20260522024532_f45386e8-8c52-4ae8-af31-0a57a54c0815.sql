
-- ========== ENUMS ==========
CREATE TYPE public.app_role AS ENUM ('admin', 'tecnico', 'almoxarife', 'lider');
CREATE TYPE public.colaborador_status AS ENUM ('ativo', 'afastado', 'desligado');
CREATE TYPE public.epi_status AS ENUM ('ativo', 'inativo');
CREATE TYPE public.movimentacao_tipo AS ENUM ('entrega', 'devolucao_normal', 'avariado', 'descarte', 'troca', 'perda', 'entrada_estoque');
CREATE TYPE public.inventario_status AS ENUM ('em_andamento', 'finalizado');

-- ========== PROFILES ==========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ========== USER ROLES ==========
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'tecnico' THEN 2
    WHEN 'almoxarife' THEN 3
    WHEN 'lider' THEN 4
  END LIMIT 1
$$;

-- ========== COLABORADORES ==========
CREATE TABLE public.colaboradores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  matricula TEXT NOT NULL UNIQUE,
  setor TEXT NOT NULL,
  funcao TEXT NOT NULL,
  gestor TEXT,
  turno TEXT,
  status colaborador_status NOT NULL DEFAULT 'ativo',
  data_admissao DATE,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.colaboradores ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_colaboradores_setor ON public.colaboradores(setor);
CREATE INDEX idx_colaboradores_status ON public.colaboradores(status);

-- ========== EPIS ==========
CREATE TABLE public.epis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL,
  ca TEXT,
  modelo TEXT,
  tamanho TEXT,
  estoque_atual INTEGER NOT NULL DEFAULT 0,
  estoque_minimo INTEGER NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(10,2) NOT NULL DEFAULT 0,
  localizacao TEXT,
  status epi_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (estoque_atual >= 0),
  CHECK (estoque_minimo >= 0)
);
ALTER TABLE public.epis ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_epis_categoria ON public.epis(categoria);
CREATE INDEX idx_epis_status ON public.epis(status);

-- ========== MOVIMENTACOES ==========
CREATE TABLE public.movimentacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo movimentacao_tipo NOT NULL,
  epi_id UUID NOT NULL REFERENCES public.epis(id) ON DELETE RESTRICT,
  colaborador_id UUID REFERENCES public.colaboradores(id) ON DELETE SET NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  motivo TEXT,
  observacao TEXT,
  usuario_responsavel UUID REFERENCES auth.users(id),
  data_movimentacao TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.movimentacoes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_mov_epi ON public.movimentacoes(epi_id);
CREATE INDEX idx_mov_colab ON public.movimentacoes(colaborador_id);
CREATE INDEX idx_mov_data ON public.movimentacoes(data_movimentacao DESC);

-- Trigger: ajustar estoque automaticamente
CREATE OR REPLACE FUNCTION public.aplicar_movimentacao_estoque()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  estoque_atual_val INTEGER;
BEGIN
  SELECT estoque_atual INTO estoque_atual_val FROM public.epis WHERE id = NEW.epi_id FOR UPDATE;

  IF NEW.tipo = 'entrega' THEN
    IF estoque_atual_val < NEW.quantidade THEN
      RAISE EXCEPTION 'Estoque insuficiente. Disponível: %', estoque_atual_val;
    END IF;
    UPDATE public.epis SET estoque_atual = estoque_atual - NEW.quantidade, updated_at = now() WHERE id = NEW.epi_id;
  ELSIF NEW.tipo IN ('devolucao_normal', 'entrada_estoque') THEN
    UPDATE public.epis SET estoque_atual = estoque_atual + NEW.quantidade, updated_at = now() WHERE id = NEW.epi_id;
  ELSIF NEW.tipo = 'troca' THEN
    -- troca: sai um (descartado/avariado) e devolve nada ao estoque por padrão. Sem alteração de estoque aqui.
    NULL;
  END IF;
  -- avariado, descarte, perda: não retornam ao estoque (já saíram na entrega)
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_aplicar_movimentacao
  BEFORE INSERT ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.aplicar_movimentacao_estoque();

-- ========== INVENTARIOS ==========
CREATE TABLE public.inventarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local TEXT NOT NULL,
  responsavel UUID REFERENCES auth.users(id),
  status inventario_status NOT NULL DEFAULT 'em_andamento',
  data_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_fim TIMESTAMPTZ
);
ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.inventario_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id UUID NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  epi_id UUID NOT NULL REFERENCES public.epis(id) ON DELETE CASCADE,
  quantidade_sistema INTEGER NOT NULL DEFAULT 0,
  quantidade_contada INTEGER,
  diferenca INTEGER GENERATED ALWAYS AS (COALESCE(quantidade_contada, 0) - quantidade_sistema) STORED,
  UNIQUE (inventario_id, epi_id)
);
ALTER TABLE public.inventario_itens ENABLE ROW LEVEL SECURITY;

-- ========== TRIGGER profiles auto-create ==========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  -- Primeiro usuário cadastrado vira admin automaticamente
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'lider');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== updated_at trigger ==========
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_colab_updated BEFORE UPDATE ON public.colaboradores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_epi_updated BEFORE UPDATE ON public.epis FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== RLS POLICIES ==========
-- profiles
CREATE POLICY "Usuários veem seu próprio perfil" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Usuários editam seu próprio perfil" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admin vê tudo profiles" ON public.profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- user_roles
CREATE POLICY "Usuários veem seus papéis" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin gerencia papéis" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- colaboradores
CREATE POLICY "Autenticados veem colaboradores" ON public.colaboradores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/Técnico criam colaboradores" ON public.colaboradores FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico'));
CREATE POLICY "Admin/Técnico editam colaboradores" ON public.colaboradores FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico'));
CREATE POLICY "Admin exclui colaboradores" ON public.colaboradores FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- epis
CREATE POLICY "Autenticados veem EPIs" ON public.epis FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/Técnico criam EPIs" ON public.epis FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico'));
CREATE POLICY "Admin/Técnico/Almoxarife editam EPIs" ON public.epis FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico') OR public.has_role(auth.uid(), 'almoxarife'));
CREATE POLICY "Admin exclui EPIs" ON public.epis FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- movimentacoes
CREATE POLICY "Autenticados veem movimentações" ON public.movimentacoes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/Técnico/Almoxarife registram movimentações" ON public.movimentacoes FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico') OR public.has_role(auth.uid(), 'almoxarife'));
CREATE POLICY "Admin exclui movimentações" ON public.movimentacoes FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- inventarios
CREATE POLICY "Autenticados veem inventários" ON public.inventarios FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/Técnico/Almoxarife criam inventários" ON public.inventarios FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico') OR public.has_role(auth.uid(), 'almoxarife'));
CREATE POLICY "Admin/Técnico/Almoxarife editam inventários" ON public.inventarios FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico') OR public.has_role(auth.uid(), 'almoxarife'));
CREATE POLICY "Admin exclui inventários" ON public.inventarios FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- inventario_itens
CREATE POLICY "Autenticados veem itens" ON public.inventario_itens FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/Técnico/Almoxarife gerenciam itens" ON public.inventario_itens FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico') OR public.has_role(auth.uid(), 'almoxarife')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'tecnico') OR public.has_role(auth.uid(), 'almoxarife'));
