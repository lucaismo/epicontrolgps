-- C2.4 / Etapa 2. Somente pelo runner PostgreSQL local descartável.
-- Não mover para migrations automáticas ou aplicar no banco conectado.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'epi_c2_staging'
     OR current_setting('port') <> '55433'
     OR current_setting('data_directory') <> '/tmp/epi-c2-pg/data'
     OR inet_server_addr() IS NOT NULL
     OR current_setting('unix_socket_directories') <> '/tmp/epi-c2-pg'
     OR current_setting('listen_addresses') <> '' THEN
    RAISE EXCEPTION 'C2: conexão fora da lista de permissões local';
  END IF;
END;
$$;

REVOKE UPDATE ON TABLE public.epis FROM PUBLIC, authenticated, anon;
REVOKE INSERT ON TABLE public.movimentacoes FROM PUBLIC, authenticated, anon;

-- Grants de tabela e de coluna são independentes. Remover também grants
-- explícitos preexistentes por coluna, antes de estabelecer a lista permitida.
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute WHERE attrelid = 'public.epis'::regclass
      AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.epis FROM PUBLIC, authenticated, anon', cols);
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute WHERE attrelid = 'public.movimentacoes'::regclass
      AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s) ON TABLE public.movimentacoes FROM PUBLIC, authenticated, anon', cols);
END;
$$;

-- Lista exata de basePayload em src/routes/_app/epis.tsx:302-309.
-- id, created_at, updated_at e estoque_atual não são editáveis diretamente.
GRANT UPDATE (nome, categoria, ca, modelo, tamanho, codigo_produto,
  estoque_minimo, custo_unitario, dias_seguranca, localizacao, status)
  ON TABLE public.epis TO authenticated;

-- Falhar fechado caso memberships/ownership tragam permissões herdadas.
-- Não revogar privilégios de owners ou de papéis de serviço silenciosamente.
DO $$
DECLARE
  role_name text;
  col_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF has_column_privilege(role_name, 'public.epis', 'estoque_atual', 'UPDATE')
       OR has_table_privilege(role_name, 'public.epis', 'UPDATE')
       OR has_any_column_privilege(role_name, 'public.movimentacoes', 'INSERT') THEN
      RAISE EXCEPTION 'C2: privilégio efetivo incompatível para %', role_name;
    END IF;
    FOR col_name IN SELECT attname FROM pg_attribute
      WHERE attrelid = 'public.epis'::regclass AND attnum > 0 AND NOT attisdropped
    LOOP
      IF (role_name = 'anon' OR col_name <> ALL(ARRAY[
          'nome','categoria','ca','modelo','tamanho','codigo_produto','estoque_minimo',
          'custo_unitario','dias_seguranca','localizacao','status']))
          AND has_column_privilege(role_name, 'public.epis', col_name, 'UPDATE') THEN
        RAISE EXCEPTION 'C2: privilégio efetivo incompatível para % na coluna %', role_name, col_name;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
COMMIT;