-- EPI Guard SaaS — Fase 1 / estrutura aditiva
-- Destino: exclusivamente staging/local. Não aplicar ao banco In-Haus.

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_nome_len CHECK (char_length(trim(nome)) BETWEEN 2 AND 120),
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT organizations_status_valid CHECK (status IN ('ativo', 'suspensa', 'quarentenada'))
);

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_unique UNIQUE (organization_id, user_id),
  CONSTRAINT organization_members_status_valid CHECK (status IN ('ativo', 'suspenso'))
);

CREATE TABLE public.migration_control (
  singleton boolean PRIMARY KEY DEFAULT true,
  bootstrap_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  onboarding_aberto boolean NOT NULL DEFAULT false,
  backfill_concluido boolean NOT NULL DEFAULT false,
  triggers_originais jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_control_singleton CHECK (singleton)
);

INSERT INTO public.migration_control (singleton) VALUES (true);

GRANT SELECT, UPDATE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organizations, public.organization_members, public.migration_control TO service_role;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_control ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_auth.is_backfill_worker()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT session_user = 'epi_guard_backfill_worker'
    AND EXISTS (
      SELECT 1 FROM pg_roles r
      WHERE r.rolname = session_user AND r.rolcanlogin
    );
$function$;

CREATE OR REPLACE FUNCTION app_auth.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(current_user = 'service_role' OR session_user = 'service_role'
    OR auth.jwt() ->> 'role' = 'service_role', false);
$function$;

CREATE OR REPLACE FUNCTION app_auth.current_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
  v_metadata jsonb;
  v_org_text text;
  v_claimed uuid;
  v_user uuid;
  v_count integer;
  v_unique uuid;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN RETURN NULL; END IF;

  v_claims := auth.jwt();
  v_metadata := v_claims -> 'app_metadata';

  IF v_metadata IS NOT NULL AND v_metadata <> 'null'::jsonb THEN
    IF jsonb_typeof(v_metadata) <> 'object' THEN
      RAISE EXCEPTION 'app_metadata inválido: acesso à organização negado.';
    END IF;
    IF v_metadata ? 'organization_id' THEN
      IF jsonb_typeof(v_metadata -> 'organization_id') <> 'string' THEN
        RAISE EXCEPTION 'organization_id inválido: acesso negado.';
      END IF;
      v_org_text := v_metadata ->> 'organization_id';
      BEGIN
        v_claimed := v_org_text::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'organization_id inválido: acesso negado.';
      END;
    END IF;
  END IF;

  IF v_claimed IS NOT NULL THEN
    PERFORM 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
     WHERE om.user_id = v_user
       AND om.organization_id = v_claimed
       AND om.status = 'ativo'
       AND o.status = 'ativo';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership ausente ou inativa para a organização reivindicada.';
    END IF;
    RETURN v_claimed;
  END IF;

  SELECT count(*), min(om.organization_id::text)::uuid
    INTO v_count, v_unique
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
   WHERE om.user_id = v_user AND om.status = 'ativo' AND o.status = 'ativo';

  IF v_count = 1 THEN RETURN v_unique; END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'app_metadata.organization_id é obrigatório para usuários com múltiplas organizações.';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION app_auth.is_org_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'ativo'
      AND o.status = 'ativo'
  ), false);
$function$;

CREATE OR REPLACE FUNCTION app_auth.is_org_admin(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'admin'
      AND om.status = 'ativo'
      AND o.status = 'ativo'
  ), false);
$function$;

CREATE OR REPLACE FUNCTION app_auth.member_role(p_organization_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT om.role FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.organization_id = p_organization_id
    AND om.user_id = auth.uid()
    AND om.status = 'ativo'
    AND o.status = 'ativo'
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION app_auth.current_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_auth.is_org_member(uuid), app_auth.is_org_admin(uuid), app_auth.member_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_auth.is_backfill_worker(), app_auth.is_service_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_auth.current_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_auth.is_org_member(uuid), app_auth.is_org_admin(uuid), app_auth.member_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_auth.is_backfill_worker(), app_auth.is_service_role() TO authenticated, service_role;

CREATE POLICY "Membros consultam organizações" ON public.organizations
  FOR SELECT TO authenticated USING (app_auth.is_org_member(id));
CREATE POLICY "Admins editam organizações" ON public.organizations
  FOR UPDATE TO authenticated
  USING (app_auth.is_org_admin(id)) WITH CHECK (app_auth.is_org_admin(id));
CREATE POLICY "Serviço gerencia organizações" ON public.organizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Membro consulta a si ou admin consulta vínculos" ON public.organization_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app_auth.is_org_admin(organization_id));
CREATE POLICY "Admin da organização cria vínculos" ON public.organization_members
  FOR INSERT TO authenticated WITH CHECK (app_auth.is_org_admin(organization_id));
CREATE POLICY "Admin da organização edita vínculos" ON public.organization_members
  FOR UPDATE TO authenticated
  USING (app_auth.is_org_admin(organization_id)) WITH CHECK (app_auth.is_org_admin(organization_id));
CREATE POLICY "Admin da organização exclui vínculos" ON public.organization_members
  FOR DELETE TO authenticated USING (app_auth.is_org_admin(organization_id));
CREATE POLICY "Serviço gerencia vínculos" ON public.organization_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Serviço controla migração" ON public.migration_control
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.guardar_onboarding_organizacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.migration_control%ROWTYPE;
BEGIN
  SELECT * INTO v_control FROM public.migration_control WHERE singleton = true;

  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'A chave da organização é imutável.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_control.onboarding_aberto THEN RETURN NEW; END IF;
    IF NOT v_control.backfill_concluido
       AND v_control.bootstrap_organization_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.organizations) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Onboarding de organizações está bloqueado.';
  END IF;

  IF NOT v_control.backfill_concluido
     AND (NEW.slug IS DISTINCT FROM OLD.slug OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Slug e status ficam protegidos durante o backfill.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_organizations_onboarding
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guardar_onboarding_organizacao();
CREATE TRIGGER trg_organizations_updated
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guardar_membership_transicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_control public.migration_control%ROWTYPE;
BEGIN
  SELECT * INTO v_control FROM public.migration_control WHERE singleton = true;

  IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Não altere organization_id de um membership; encerre e crie outro vínculo.';
  END IF;

  IF NOT v_control.backfill_concluido THEN
    IF NEW.organization_id IS NULL
       OR NEW.organization_id IS DISTINCT FROM v_control.bootstrap_organization_id THEN
      RAISE EXCEPTION 'Durante o backfill só são aceitos vínculos com a organização In-Haus configurada.';
    END IF;
    IF TG_OP = 'INSERT' AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = NEW.user_id AND om.organization_id <> NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'Vínculos com outras organizações estão bloqueados durante o backfill.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_organization_members_transition
  BEFORE INSERT OR UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.guardar_membership_transicao();
CREATE TRIGGER trg_organization_members_updated
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_migration_control_updated
  BEFORE UPDATE ON public.migration_control
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Fotografia dos 11 triggers operacionais originais, antes de adicionar os novos.
UPDATE public.migration_control mc
SET triggers_originais = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tabela', c.relname,
    'trigger', t.tgname,
    'funcao', p.pronamespace::regnamespace::text || '.' || p.proname,
    'estado', t.tgenabled,
    'definicao', pg_get_triggerdef(t.oid)
  ) ORDER BY c.relname, t.tgname), '[]'::jsonb)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace pn ON pn.oid = p.pronamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND c.relname IN (
      'colaboradores', 'epis', 'movimentacoes', 'inventarios', 'inventario_itens',
      'compras_config', 'pedidos_compra', 'compras_ajustes', 'colaborador_tamanhos'
    )
)
WHERE mc.singleton = true;

ALTER TABLE public.colaboradores ADD COLUMN organization_id uuid;
ALTER TABLE public.epis ADD COLUMN organization_id uuid;
ALTER TABLE public.movimentacoes ADD COLUMN organization_id uuid;
ALTER TABLE public.movimentacoes ADD COLUMN movimentacao_vinculada_id uuid;
ALTER TABLE public.inventarios ADD COLUMN organization_id uuid;
ALTER TABLE public.inventario_itens ADD COLUMN organization_id uuid;
ALTER TABLE public.compras_config ADD COLUMN organization_id uuid;
ALTER TABLE public.pedidos_compra ADD COLUMN organization_id uuid;
ALTER TABLE public.compras_ajustes ADD COLUMN organization_id uuid;
ALTER TABLE public.colaborador_tamanhos ADD COLUMN organization_id uuid;

ALTER TABLE public.colaboradores ADD CONSTRAINT colaboradores_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.epis ADD CONSTRAINT epis_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.inventarios ADD CONSTRAINT inventarios_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.inventario_itens ADD CONSTRAINT inventario_itens_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.compras_config ADD CONSTRAINT compras_config_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.pedidos_compra ADD CONSTRAINT pedidos_compra_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.compras_ajustes ADD CONSTRAINT compras_ajustes_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.colaborador_tamanhos ADD CONSTRAINT colaborador_tamanhos_organization_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.colaboradores ADD CONSTRAINT colaboradores_org_id_unique UNIQUE (organization_id, id);
ALTER TABLE public.colaboradores ADD CONSTRAINT colaboradores_org_matricula_unique UNIQUE (organization_id, matricula);
ALTER TABLE public.epis ADD CONSTRAINT epis_org_id_unique UNIQUE (organization_id, id);
ALTER TABLE public.inventarios ADD CONSTRAINT inventarios_org_id_unique UNIQUE (organization_id, id);
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_org_id_unique UNIQUE (organization_id, id);
ALTER TABLE public.compras_config ADD CONSTRAINT compras_config_org_singleton_unique UNIQUE (organization_id, singleton);
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_org_vinculo_unique UNIQUE (organization_id, movimentacao_vinculada_id);
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_vinculo_apenas_entrega
  CHECK (movimentacao_vinculada_id IS NULL OR tipo = 'entrega');
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_vinculo_nao_circular
  CHECK (movimentacao_vinculada_id IS NULL OR movimentacao_vinculada_id <> id);

ALTER TABLE public.colaborador_tamanhos ADD CONSTRAINT colaborador_tamanhos_org_colaborador_fkey
  FOREIGN KEY (organization_id, colaborador_id)
  REFERENCES public.colaboradores(organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_org_epi_fkey
  FOREIGN KEY (organization_id, epi_id)
  REFERENCES public.epis(organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_org_colaborador_fkey
  FOREIGN KEY (organization_id, colaborador_id)
  REFERENCES public.colaboradores(organization_id, id)
  ON DELETE SET NULL (colaborador_id) NOT VALID;
ALTER TABLE public.inventario_itens ADD CONSTRAINT inventario_itens_org_inventario_fkey
  FOREIGN KEY (organization_id, inventario_id)
  REFERENCES public.inventarios(organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.inventario_itens ADD CONSTRAINT inventario_itens_org_epi_fkey
  FOREIGN KEY (organization_id, epi_id)
  REFERENCES public.epis(organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.pedidos_compra ADD CONSTRAINT pedidos_compra_org_epi_fkey
  FOREIGN KEY (organization_id, epi_id)
  REFERENCES public.epis(organization_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.compras_ajustes ADD CONSTRAINT compras_ajustes_org_epi_fkey
  FOREIGN KEY (organization_id, epi_id)
  REFERENCES public.epis(organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_org_vinculo_fkey
  FOREIGN KEY (organization_id, movimentacao_vinculada_id)
  REFERENCES public.movimentacoes(organization_id, id) ON DELETE RESTRICT NOT VALID;

CREATE INDEX colaboradores_organization_idx ON public.colaboradores (organization_id, status);
CREATE INDEX epis_organization_idx ON public.epis (organization_id, status);
CREATE INDEX movimentacoes_organization_data_idx ON public.movimentacoes (organization_id, data_movimentacao DESC);
CREATE INDEX movimentacoes_organization_colab_idx ON public.movimentacoes (organization_id, colaborador_id);
CREATE INDEX movimentacoes_vinculada_idx ON public.movimentacoes (movimentacao_vinculada_id)
  WHERE movimentacao_vinculada_id IS NOT NULL;
CREATE INDEX inventarios_organization_status_idx ON public.inventarios (organization_id, status);
CREATE INDEX inventario_itens_organization_idx ON public.inventario_itens (organization_id, inventario_id);
CREATE INDEX compras_config_organization_idx ON public.compras_config (organization_id);
CREATE INDEX pedidos_compra_organization_idx ON public.pedidos_compra (organization_id, status);
CREATE INDEX compras_ajustes_organization_idx ON public.compras_ajustes (organization_id, ano, mes);
CREATE INDEX colaborador_tamanhos_organization_idx ON public.colaborador_tamanhos (organization_id, colaborador_id);
CREATE INDEX organization_members_user_idx ON public.organization_members (user_id, status);

REVOKE ALL ON FUNCTION public.guardar_onboarding_organizacao(), public.guardar_membership_transicao() FROM PUBLIC, anon, authenticated;
