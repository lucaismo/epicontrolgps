\set ON_ERROR_STOP on
SELECT test.eq((SELECT jsonb_array_length(triggers_originais)::text FROM public.migration_control WHERE singleton), '11', 'Baseline contém 11 triggers originais');
SELECT test.eq((SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'trg_tmp_%' AND NOT tgisinternal), '9', 'Nove triggers temporários de UPDATE instalados');

-- Mesmo um superusuário não pode abrir uma segunda organização durante o backfill.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.organizations (nome, slug) VALUES ('Organização Bloqueada', 'organizacao-bloqueada');
    RAISE EXCEPTION 'FALHA: segunda organização foi aceita';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Onboarding de segunda organização bloqueado durante backfill');
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (NULL, 'a0000000-0000-0000-0000-000000000001', 'admin');
    RAISE EXCEPTION 'FALHA: membership NULL foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Membership com organization_id NULL rejeitado');
  END;
  BEGIN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES ('10000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'admin');
    RAISE EXCEPTION 'FALHA: membership de outro tenant foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Membership de organização diferente da In-Haus rejeitado');
  END;
END;
$$;

-- SET ROLE não transforma um usuário no worker: session_user permanece inalterado.
DO $$
BEGIN
  BEGIN
    SET ROLE epi_guard_backfill_worker;
    PERFORM public.executar_backfill_lote('epis', 1);
    RAISE EXCEPTION 'FALHA: SET ROLE assumiu a identidade do worker';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    RESET ROLE;
    PERFORM test.ok(true, 'SET ROLE não concede identidade de backfill_worker');
  END;
END;
$$;

SELECT test.claims('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
SET ROLE authenticated;

-- O fluxo atual não envia organization_id: o tenant único autenticado é atribuído no INSERT.
INSERT INTO public.colaboradores (id, nome, matricula, funcao)
VALUES ('c0000000-0000-0000-0000-000000000005', 'Inserção Durante Transição', '000005', 'Operador');
SELECT test.eq((SELECT organization_id::text FROM public.colaboradores WHERE id = 'c0000000-0000-0000-0000-000000000005'),
  '10000000-0000-0000-0000-000000000001', 'INSERT sem tenant recebe somente a organização autenticada');

DO $$
BEGIN
  BEGIN
    UPDATE public.colaboradores SET organization_id = '10000000-0000-0000-0000-000000000009'
    WHERE id = 'c0000000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'FALHA: UPDATE cruzado foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'UPDATE de organization_id para outro tenant é bloqueado');
  END;
END;
$$;

UPDATE public.colaboradores SET nome = 'Atualização Normal Durante Transição'
WHERE id = 'c0000000-0000-0000-0000-000000000005';
SELECT test.eq((SELECT nome FROM public.colaboradores WHERE id = 'c0000000-0000-0000-0000-000000000005'),
  'Atualização Normal Durante Transição', 'UPDATE comum sem mudança de tenant permanece funcional');

DO $$
BEGIN
  BEGIN
    PERFORM public.executar_backfill_lote('epis', 1);
    RAISE EXCEPTION 'FALHA: usuário autenticado executou backfill';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'Usuário autenticado não executa backfill');
  END;
END;
$$;

RESET ROLE;
-- app_metadata presente com tipo inválido nega sem fallback para membership única.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', 'a0000000-0000-0000-0000-000000000001', 'role', 'authenticated', 'app_metadata', 'invalido'
  )::text, false);
  BEGIN
    PERFORM app_auth.current_org_id();
    RAISE EXCEPTION 'FALHA: app_metadata textual foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'app_metadata presente com tipo inválido nega sem fallback');
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', 'a0000000-0000-0000-0000-000000000001', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('organization_id', 123)
  )::text, false);
  BEGIN
    PERFORM app_auth.current_org_id();
    RAISE EXCEPTION 'FALHA: organization_id numérico foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    PERFORM test.ok(true, 'organization_id não textual nega sem fallback');
  END;
END;
$$;
