-- Somente ambiente local descartável: compatibilidade mínima com objetos Supabase.
DO $$
BEGIN
  IF to_regrole('anon') IS NULL THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
  IF to_regrole('authenticated') IS NULL THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
  IF to_regrole('service_role') IS NULL THEN EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS'; END IF;
  IF to_regrole('epi_guard_backfill_worker') IS NULL THEN
    EXECUTE 'CREATE ROLE epi_guard_backfill_worker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE';
  END IF;
END;
$$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;
