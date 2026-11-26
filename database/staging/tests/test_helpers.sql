CREATE SCHEMA test;
CREATE TABLE test.results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION test.ok(p_condition boolean, p_label text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN RAISE EXCEPTION 'FALHA: %', p_label; END IF;
  INSERT INTO test.results (label) VALUES (p_label);
END;
$$;
CREATE OR REPLACE FUNCTION test.eq(p_actual text, p_expected text, p_label text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM test.ok(p_actual IS NOT DISTINCT FROM p_expected,
    p_label || ' (esperado=' || COALESCE(p_expected, 'NULL') || ', atual=' || COALESCE(p_actual, 'NULL') || ')');
END;
$$;
CREATE OR REPLACE FUNCTION test.claims(p_user uuid, p_org uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user::text,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('organization_id', p_org::text)
  )::text, false);
END;
$$;
GRANT USAGE ON SCHEMA test TO authenticated, service_role, epi_guard_backfill_worker;
GRANT EXECUTE ON FUNCTION test.ok(boolean, text), test.eq(text, text, text), test.claims(uuid, uuid) TO authenticated, service_role, epi_guard_backfill_worker;
