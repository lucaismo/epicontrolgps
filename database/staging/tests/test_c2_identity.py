"""C2.5 Parte B: identidade e autoria derivadas de auth.uid() (somente socket local)."""
import json
import subprocess
import sys
import unittest
sys.dont_write_bytecode = True
import test_c2 as c2

PATCH = c2.ROOT / 'database/staging/c2_corrections/03_identity_authorship.sql'
INV = 'f0000000-0000-0000-0000-000000000001'
GLASSES = 'd0000000-0000-0000-0000-000000000005'
COLAB4 = 'c0000000-0000-0000-0000-000000000004'
SIGS = ['public.registrar_entrega_multipla(uuid,jsonb,text,timestamptz,uuid)', 'public.finalizar_inventario(uuid,uuid)',
        'public.editar_entrega(uuid,uuid,integer,timestamptz,text)', c2.ENTRY, c2.DELETE, c2.ATOMIC]


def rows(q):
    return json.loads(c2.sql(f"SELECT coalesce(json_agg(t),'[]'::json) FROM ({q}) t").stdout)


def contracts():
    sigs = ','.join(f"'{s}'::regprocedure" for s in SIGS)
    return rows(f"""SELECT p.oid, p.proname, p.proargnames, p.proargtypes::text a, p.prorettype::text r,
      p.proowner, p.prosecdef, p.proconfig, p.proacl::text acl, p.provolatile FROM pg_proc p WHERE p.oid IN ({sigs}) ORDER BY p.oid""")


def service_privs():
    return rows("""SELECT c.relname, has_table_privilege('service_role',c.oid,'SELECT') s, has_table_privilege('service_role',c.oid,'INSERT') i,
      has_table_privilege('service_role',c.oid,'UPDATE') u, has_table_privilege('service_role',c.oid,'DELETE') d
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1""")


def multi(p_user, epi=GLASSES, obs='C2.5 id'):
    pu = 'NULL' if p_user is None else f"'{p_user}'"
    return f"SELECT public.registrar_entrega_multipla('{COLAB4}','[{{\"epi_id\":\"{epi}\",\"quantidade\":1}}]'::jsonb,'{obs}','2026-11-26T20:40:00Z',{pu})"


def finalize(p_user):
    pu = 'NULL' if p_user is None else f"'{p_user}'"
    return f"UPDATE public.inventario_itens SET quantidade_contada=10 WHERE inventario_id='{INV}'; SELECT public.finalizar_inventario('{INV}',{pu})"


def edit():
    return f"SELECT public.editar_entrega('{c2.MOV}','{c2.EPI}',2,NULL,'C2.5 edit')"



class IdentityTests(unittest.TestCase):
    def deny(self, query, uid, role='authenticated', state='42501'):
        r = c2.as_user(uid, query, role, check=False)
        self.assertNotEqual(r.returncode, 0, 'Operação proibida foi aceita')
        if state:
            self.assertIn(state, r.stderr, r.stderr)

    def test_01_forged_p_usuario_ignored_delivery_and_swap(self):
        for uid, forged in ((c2.TECH, c2.ADMIN), (c2.ALMOX, c2.ADMIN2), (c2.ADMIN, c2.TECH), (c2.TECH, c2.UNKNOWN), (c2.TECH, None)):
            with self.subTest(uid=uid, forged=forged):
                c2.as_user(uid, multi(c2.TECH) + "; " + multi(forged, obs='C2.5 swap') + f""";
                  RESET ROLE;
                  SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE observacao LIKE 'C2.5 %' AND tipo='entrega' AND usuario_responsavel='{uid}'),'2','Entregas atribuídas à sessão');
                  SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes WHERE tipo='troca' AND data_movimentacao='2026-11-26T20:40:00Z' AND usuario_responsavel='{uid}'),'Troca automática atribuída à sessão');
                  SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE data_movimentacao='2026-11-26T20:40:00Z' AND usuario_responsavel IS DISTINCT FROM '{uid}'),'0','Nenhuma autoria forjada');
                  SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='INSERT' AND dados_novos->>'data_movimentacao' LIKE '2026-11-26%20:40%' AND usuario_id='{uid}'),'3','Auditoria com autor real')""")

    def test_02_forged_p_usuario_ignored_finalize(self):
        for uid, forged in ((c2.ALMOX, c2.ADMIN), (c2.TECH, c2.UNKNOWN), (c2.ADMIN, None)):
            with self.subTest(uid=uid, forged=forged):
                c2.as_user(uid, finalize(forged) + f"""; RESET ROLE;
                  SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes WHERE tipo='ajuste_entrada' AND quantidade=2 AND usuario_responsavel='{uid}'),'Ajuste atribuído à sessão');
                  SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE tipo::text LIKE 'ajuste_%' AND usuario_responsavel IS DISTINCT FROM '{uid}'),'0','Sem ajuste forjado');
                  SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{c2.EPI}'),'10','Regra de estoque preservada');
                  SELECT test.ok(EXISTS(SELECT 1 FROM public.auditoria WHERE tabela='movimentacoes' AND dados_novos->>'tipo'='ajuste_entrada' AND usuario_id='{uid}'),'Ajuste auditado')""")

    def test_03_entry_forged_p_usuario_regression(self):
        c2.as_user(c2.ALMOX, c2.entry(c2.ADMIN) + f"; RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes WHERE tipo='entrada_estoque' AND usuario_responsavel='{c2.ALMOX}') AND NOT EXISTS(SELECT 1 FROM public.movimentacoes WHERE tipo='entrada_estoque' AND usuario_responsavel='{c2.ADMIN}'),'Entrada da sessão')")

    def test_04_no_profile_or_disallowed_profile_denied(self):
        for uid in (c2.NO_ROLE, c2.LIDER, c2.UNKNOWN):
            with self.subTest(uid=uid):
                self.deny(multi(c2.ADMIN), uid)
                self.deny(finalize(c2.ADMIN), uid)
                self.deny(edit(), uid, state=None)
        for uid in (c2.TECH, c2.ALMOX):
            self.deny(edit(), uid, state=None)

    def test_05_session_without_identity_rejected(self):
        for role in ('authenticated', 'anon', 'service_role'):
            for name, q in (('multipla', multi(c2.ADMIN)), ('finalizar', finalize(c2.ADMIN)), ('editar', edit()),
                            ('entrada', c2.entry(c2.ADMIN)), ('excluir', c2.deletion(c2.ADMIN))):
                with self.subTest(role=role, op=name):
                    self.deny(q, None, role, state=None)

    def test_06_metadata_claims_do_not_grant(self):
        for q in (multi(c2.ADMIN), finalize(c2.ADMIN)):
            r = c2.as_user(c2.NO_ROLE, q, check=False, metadata={'role': 'admin', 'sub': c2.ADMIN})
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('42501', r.stderr)

    def test_07_admin_flows_work(self):
        c2.as_user(c2.ADMIN, edit() + f"; RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='UPDATE' AND registro_id='{c2.MOV}' AND usuario_id='{c2.ADMIN}'),'Edição auditada pelo admin')")
        c2.as_user(c2.ADMIN, c2.deletion(c2.TECH) + f"; RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.auditoria WHERE operacao='DELETE' AND registro_id='{c2.MOV}' AND usuario_id='{c2.ADMIN}'),'Exclusão auditada pelo admin')")

    def test_08_contracts_unchanged(self):
        before = json.loads((c2.DIR / 'identity_before.json').read_text())
        self.assertEqual(contracts(), before['contracts'])

    def test_09_service_role_capabilities_preserved(self):
        before = json.loads((c2.DIR / 'identity_before.json').read_text())
        self.assertEqual(service_privs(), before['service'])
        # service_role sem sub não é tratado como humano nem herda autoria.
        for q in (multi(c2.ADMIN), finalize(c2.ADMIN)):
            self.deny(q, None, 'service_role')

    def test_10_idempotent_reapplication(self):
        self.assertEqual(contracts(), json.loads((c2.DIR / 'identity_first.json').read_text()))

    def test_11_patch_rejects_wrong_local_database(self):
        r = subprocess.run(c2.PSQL[:-6] + ['-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', str(PATCH)], env=c2.ENV, text=True, capture_output=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('lista de permissões', r.stderr)

    def test_12_history_not_rewritten(self):
        before = json.loads((c2.DIR / 'identity_before.json').read_text())
        self.assertEqual(rows("SELECT id, usuario_responsavel FROM public.movimentacoes ORDER BY id"), before['authors'])


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] in ('--snapshot-before', '--snapshot-first'):
        if sys.argv[1] == '--snapshot-before':
            data = dict(contracts=contracts(), service=service_privs(), authors=rows("SELECT id, usuario_responsavel FROM public.movimentacoes ORDER BY id"))
            (c2.DIR / 'identity_before.json').write_text(json.dumps(data, indent=2))
        else:
            (c2.DIR / 'identity_first.json').write_text(json.dumps(contracts(), indent=2))
        sys.exit(0)
    unittest.main(verbosity=2)
