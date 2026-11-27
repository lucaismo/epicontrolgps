"""C2.3: chamadas SQL reais no socket local; não simula gateway/JWT assinado."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

DIR = Path('/tmp/epi-c2-pg')
ROOT = Path(__file__).resolve().parents[3]
ENV = {'PATH': os.environ.get('PATH', '/bin:/usr/bin'), 'HOME': '/tmp', 'LC_ALL': 'C'}
PSQL = ['psql', '-X', '-q', '-A', '-t', '-h', str(DIR), '-p', '55433', '-U', 'lovable', '-d', 'epi_c2_staging', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
ADMIN = 'a0000000-0000-0000-0000-000000000001'
ADMIN2 = 'a0000000-0000-0000-0000-000000000002'
TECH = 'b0000000-0000-0000-0000-000000000001'
ALMOX = 'b0000000-0000-0000-0000-000000000002'
LIDER = 'b0000000-0000-0000-0000-000000000003'
NO_ROLE = 'b0000000-0000-0000-0000-000000000004'
UNKNOWN = '90000000-0000-0000-0000-000000000099'
EPI = 'd0000000-0000-0000-0000-000000000001'
MOV = 'e0000000-0000-0000-0000-000000000001'
ATOMIC = 'public.registrar_entrega_atomica(uuid,uuid,integer,text,timestamptz,uuid,text,uuid,integer,text,text)'
ENTRY = 'public.registrar_entrada_estoque(uuid,integer,text,text,uuid)'
DELETE = 'public.excluir_entrega(uuid,uuid)'
# Após a Etapa 3 (C2_STAGE=3), somente o corpo destas funções muda.
STAGE3_CHANGED = ('registrar_entrega_multipla', 'finalizar_inventario') if os.environ.get('C2_STAGE') == '3' else ()


def sql(query, check=True):
    result = subprocess.run(PSQL + ['-c', query], env=ENV, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise AssertionError(result.stderr)
    return result


def as_user(uid, query, role='authenticated', check=True, metadata=None):
    assert role in ('authenticated', 'anon', 'service_role')
    claims = {'role': role}
    if uid is not None:
        claims['sub'] = uid
    if metadata:
        claims['user_metadata'] = metadata
    text = json.dumps(claims).replace("'", "''")
    return sql(f"BEGIN; SET LOCAL ROLE {role}; SELECT set_config('request.jwt.claims', '{text}', true); {query}; ROLLBACK;", check)


def entry(p_user=ADMIN, qty='3', epi=EPI):
    param = 'NULL' if p_user is None else f"'{p_user}'::uuid"
    return f"SELECT public.registrar_entrada_estoque(p_epi_id => '{epi}', p_quantidade => {qty}, p_motivo => 'NF local', p_observacao => 'C2 local', p_usuario => {param})"


def deletion(p_user=ADMIN, mov=MOV):
    param = 'NULL' if p_user is None else f"'{p_user}'::uuid"
    return f"SELECT public.excluir_entrega(p_mov_id => '{mov}', p_usuario => {param})"


def normalize(snap):
    """Remove de um snapshot salvo os corpos alterados intencionalmente pela Etapa 3."""
    for f in snap.get('functions', []):
        if f['nspname'] == 'public' and f['proname'] in STAGE3_CHANGED:
            f.pop('prosrc', None)
    return snap


def snapshot():
    def rows(q):
        return json.loads(sql(f'SELECT coalesce(json_agg(t), \'[]\'::json) FROM ({q}) t').stdout)
    functions = rows("""SELECT p.oid, n.nspname, p.proname, p.prosrc, p.proacl::text AS acl,
      p.proowner, p.prosecdef, p.proconfig, p.proargnames, p.proargtypes::text AS args,
      p.prorettype::text AS result FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','app_auth','auth') ORDER BY p.oid""")
    tables = rows("""SELECT c.oid, c.relname, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.oid""")
    policies = rows("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")
    triggers = rows("""SELECT t.oid,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','auth') ORDER BY t.oid""")
    for f in functions:
        if f['nspname'] == 'public' and f['proname'] in STAGE3_CHANGED:
            f.pop('prosrc')
    data = {}
    for table in tables:
        name = table['relname']
        assert name.replace('_','').isalnum()
        data[name] = rows(f'SELECT * FROM public.{name} ORDER BY id')
    service_atomic = sql(f"SELECT has_function_privilege('service_role', '{ATOMIC}', 'EXECUTE')").stdout.strip()
    return dict(functions=functions, tables=tables, policies=policies, triggers=triggers, data=data, service_atomic=service_atomic)


class C2Tests(unittest.TestCase):
    def deny(self, result, state='42501'):
        self.assertNotEqual(result.returncode, 0, 'Operação proibida foi aceita')
        self.assertIn(state, result.stderr, result.stderr)

    def test_01_isolation(self):
        value = sql("SELECT current_database(), current_setting('port'), current_setting('data_directory'), current_setting('unix_socket_directories'), current_setting('listen_addresses'), inet_server_addr() IS NULL").stdout.strip()
        self.assertEqual(value, 'epi_c2_staging|55433|/tmp/epi-c2-pg/data|/tmp/epi-c2-pg||t')

    def test_02_contracts_and_unchanged_objects(self):
        before = json.loads((DIR / 'before.json').read_text())
        after = snapshot()
        if STAGE3_CHANGED:
            # ACLs de tabela mudam por desenho na Etapa 2 e pelas roles de teste da C2.5;
            # essas ACLs são verificadas por test_c2_boundary e test_c2_identity.
            for t in before['tables'] + after['tables']:
                t.pop('acl')
        for key in ('tables', 'policies', 'triggers', 'data'):
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(len(after['functions']), len(before['functions']))
        for old, new in zip(before['functions'], after['functions']):
            with self.subTest(function=old['proname']):
                old, new = dict(old), dict(new)
                if old['nspname'] == 'public' and old['proname'] in ('excluir_entrega', 'registrar_entrada_estoque') + STAGE3_CHANGED:
                    old.pop('prosrc', None); new.pop('prosrc', None)
                if old['nspname'] == 'public' and old['proname'] == 'registrar_entrega_atomica':
                    old.pop('acl'); new.pop('acl')
                self.assertEqual(new, old)

    def test_03_atomic_execute_revoked(self):
        for role in ('authenticated', 'anon'):
            with self.subTest(role=role):
                self.assertEqual(sql(f"SELECT has_function_privilege('{role}', '{ATOMIC}', 'EXECUTE')").stdout.strip(), 'f')
                query = f"SELECT public.registrar_entrega_atomica('c0000000-0000-0000-0000-000000000001','{EPI}',1,'local',now(),'{ADMIN}','nenhuma',NULL,NULL,NULL,NULL)"
                self.deny(as_user(ADMIN, query, role, check=False))
        # O replay histórico não concede EXECUTE a service_role nesta função.
        # A contenção deve preservar exatamente o privilégio anterior, não criá-lo.
        before = json.loads((DIR / 'before.json').read_text())
        self.assertEqual(sql(f"SELECT has_function_privilege('service_role', '{ATOMIC}', 'EXECUTE')").stdout.strip(), before['service_atomic'])

    def test_04_entry_denies_unauthorized_and_spoofing(self):
        for uid in (NO_ROLE, LIDER, UNKNOWN, None):
            with self.subTest(uid=uid):
                self.deny(as_user(uid, entry(ADMIN2), check=False))

    def test_05_delete_denies_unauthorized_and_spoofing(self):
        for uid in (NO_ROLE, LIDER, TECH, ALMOX, UNKNOWN, None):
            with self.subTest(uid=uid):
                self.deny(as_user(uid, deletion(ADMIN2), check=False))

    def test_06_anon_cannot_call_protected_rpcs_even_with_admin_claim(self):
        for uid in (None, ADMIN):
            for query in (entry(), deletion()):
                with self.subTest(uid=uid, query=query):
                    self.deny(as_user(uid, query, role='anon', check=False))

    def test_07_user_metadata_cannot_grant_admin(self):
        for query in (entry(), deletion()):
            with self.subTest(query=query):
                self.deny(as_user(NO_ROLE, query, check=False, metadata={'role': 'admin', 'user_id': ADMIN}))

    def test_08_entry_legitimate_roles_stock_and_audit(self):
        for uid in (ADMIN, TECH, ALMOX):
            with self.subTest(uid=uid):
                as_user(uid, entry(uid) + f"; SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{EPI}'),'11','Entrada soma exatamente três'); RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes m JOIN public.auditoria a ON a.registro_id=m.id WHERE m.observacao='C2 local' AND m.tipo='entrada_estoque' AND m.quantidade=3 AND m.usuario_responsavel='{uid}' AND a.tabela='movimentacoes' AND a.operacao='INSERT' AND a.usuario_id='{uid}'),'Entrada tem responsável autenticado e auditoria')")

    def test_09_entry_ignores_forged_and_null_p_usuario(self):
        for param in (ADMIN2, None):
            with self.subTest(param=param):
                as_user(TECH, entry(param) + f"; RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes m JOIN public.auditoria a ON a.registro_id=m.id WHERE m.observacao='C2 local' AND m.usuario_responsavel='{TECH}' AND a.usuario_id='{TECH}'),'Identidade não vem de p_usuario')")

    def test_10_entry_quantity_validation_preserved(self):
        for qty in ('0', '-1', 'NULL'):
            with self.subTest(qty=qty):
                self.deny(as_user(ADMIN, entry(qty=qty), check=False), 'P0001')

    def test_11_delete_legitimate_admin_restores_stock_and_audits(self):
        for param in (ADMIN, NO_ROLE, None):
            with self.subTest(param=param):
                as_user(ADMIN, deletion(param) + f"; SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{EPI}'),'10','Excluir devolve as duas unidades'); SELECT test.ok(NOT EXISTS(SELECT 1 FROM public.movimentacoes WHERE id='{MOV}'),'Entrega removida'); SELECT test.ok(EXISTS(SELECT 1 FROM public.auditoria WHERE tabela='movimentacoes' AND registro_id='{MOV}' AND operacao='DELETE' AND usuario_id='{ADMIN}' AND dados_anteriores->>'quantidade'='2'),'Exclusão auditada')")

    def test_12_delete_preserves_existing_single_pair_behavior(self):
        as_user(ADMIN, deletion(mov='e0000000-0000-0000-0000-000000000010') + "; SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000004'),'50','Exclusão pareada restitui só entrega'); SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE id IN ('e0000000-0000-0000-0000-000000000010','e0000000-0000-0000-0000-000000000011')),'0','Entrega e troca únicas removidas'); SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE operacao='DELETE' AND tabela='movimentacoes' AND registro_id IN ('e0000000-0000-0000-0000-000000000010','e0000000-0000-0000-0000-000000000011') AND usuario_id='a0000000-0000-0000-0000-000000000001'),'2','Duas exclusões auditadas')")

    def test_13_delete_missing_or_non_delivery_preserved(self):
        for mov in (UNKNOWN, 'e0000000-0000-0000-0000-000000000011'):
            with self.subTest(mov=mov):
                self.deny(as_user(ADMIN, deletion(mov=mov), check=False), 'P0001')

    def test_14_entry_invalid_epi_rolls_back(self):
        self.deny(as_user(ADMIN, entry(epi=UNKNOWN), check=False), '23503')
        self.assertEqual(sql(f"SELECT estoque_atual FROM public.epis WHERE id='{EPI}'").stdout.strip(), '8')

    def test_15_existing_multiple_delivery_and_triggers(self):
        as_user(TECH, f"SELECT test.eq(public.registrar_entrega_multipla('c0000000-0000-0000-0000-000000000004','[{{\"epi_id\":\"d0000000-0000-0000-0000-000000000005\",\"quantidade\":1}}]'::jsonb,'C2 regressão','2026-11-26T19:57:00Z','{TECH}')::text,'1','RPC múltipla preserva retorno'); SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='d0000000-0000-0000-0000-000000000005'),'29','Trigger baixa entrega'); RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='INSERT' AND usuario_id='{TECH}' AND dados_novos->>'observacao'='C2 regressão'),'Auditoria da entrega continua')")

    def test_16_service_without_user_cannot_bypass_identity(self):
        for query in (entry(ADMIN), deletion(ADMIN)):
            with self.subTest(query=query):
                self.deny(as_user(None, query, role='service_role', check=False))

    def test_17_runner_rejects_external_arguments(self):
        for args in (['--host', 'example.invalid'], ['--port', '5432'], ['--database', 'postgres']):
            with self.subTest(args=args):
                result = subprocess.run(['bash', str(ROOT / 'database/staging/tests/run_c2.sh')] + args, env=ENV, text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('não permitidos', result.stderr)

    def test_18_runner_discards_ambient_pg_settings(self):
        env = dict(ENV, PGHOST='example.invalid', PGHOSTADDR='192.0.2.1', PGPORT='5432', PGDATABASE='postgres', PGSERVICE='operational', PGOPTIONS='invalid')
        result = subprocess.run(['bash', str(ROOT / 'database/staging/tests/run_c2.sh'), '--check-only'], env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('socket=/tmp/epi-c2-pg', result.stdout)

    def test_19_no_legacy_data_changed_after_tests(self):
        self.assertEqual(snapshot()['data'], json.loads((DIR / 'before.json').read_text())['data'])

    def test_20_sql_patch_rejects_wrong_local_database(self):
        args = list(PSQL)
        args[args.index('-d') + 1] = 'postgres'
        result = subprocess.run(args + ['-f', str(ROOT / 'database/staging/c2_corrections/01_containment_rpcs.sql')], env=ENV, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('conexão fora da lista de permissões local', result.stderr)


if __name__ == '__main__':
    # Verificação somente leitura antes de snapshot/testes.
    identity = sql("SELECT current_database(),current_setting('data_directory'),current_setting('port'),inet_server_addr() IS NULL").stdout.strip()
    if identity != 'epi_c2_staging|/tmp/epi-c2-pg/data|55433|t':
        raise SystemExit('C2: destino fora da lista de permissões')
    if len(sys.argv) == 3 and sys.argv[1] == '--snapshot':
        path = Path(sys.argv[2])
        if path != DIR / 'before.json':
            raise SystemExit('C2: destino de snapshot inválido')
        path.write_text(json.dumps(snapshot(), indent=2))
        print('Snapshot local registrado antes da contenção')
    else:
        unittest.main(verbosity=2)
