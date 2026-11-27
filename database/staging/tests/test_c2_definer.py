"""C2.5 Parte A: owner não superuser para funções SECURITY DEFINER (somente socket local)."""
import json
import sys
import unittest
sys.dont_write_bytecode = True
import test_c2 as c2

NOBYPASS = 'c2_definer_nobypass'
BYPASS = 'c2_definer_bypass'
FUNCS = {
    'entrada': c2.ENTRY,
    'multipla': 'public.registrar_entrega_multipla(uuid,jsonb,text,timestamptz,uuid)',
    'excluir': c2.DELETE,
    'editar': 'public.editar_entrega(uuid,uuid,integer,timestamptz,text)',
    'finalizar': 'public.finalizar_inventario(uuid,uuid)',
}
GLASSES = 'd0000000-0000-0000-0000-000000000005'
INV = 'f0000000-0000-0000-0000-000000000001'
OPS = {
    'entrada': (c2.ADMIN, c2.entry(c2.ADMIN),
        f"SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{c2.EPI}'),'11','entrada')"),
    'multipla': (c2.TECH, f"SELECT public.registrar_entrega_multipla('c0000000-0000-0000-0000-000000000004','[{{\"epi_id\":\"{GLASSES}\",\"quantidade\":1}}]'::jsonb,'C2.5 owner','2026-11-26T20:30:00Z','{c2.TECH}')",
        f"SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{GLASSES}'),'29','multipla')"),
    'excluir': (c2.ADMIN, c2.deletion(c2.ADMIN),
        f"SELECT test.ok(NOT EXISTS(SELECT 1 FROM public.movimentacoes WHERE id='{c2.MOV}'),'excluir')"),
    'editar': (c2.ADMIN, f"SELECT public.editar_entrega('{c2.MOV}','{c2.EPI}',2,NULL,'C2.5 edit')",
        f"SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes WHERE id='{c2.MOV}' AND quantidade=2 AND observacao='C2.5 edit'),'editar')"),
    'finalizar': (c2.ALMOX, f"SELECT public.finalizar_inventario('{INV}','{c2.ALMOX}')",
        f"SELECT test.ok(EXISTS(SELECT 1 FROM public.inventarios WHERE id='{INV}' AND status='finalizado') AND EXISTS(SELECT 1 FROM public.movimentacoes WHERE tipo='ajuste_entrada' AND quantidade=2 AND epi_id='{c2.EPI}'),'finalizar')"),
}


def setup_roles():
    c2.sql(f"""DO $$ BEGIN
      IF to_regrole('{NOBYPASS}') IS NULL THEN CREATE ROLE {NOBYPASS} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE; END IF;
      IF to_regrole('{BYPASS}') IS NULL THEN CREATE ROLE {BYPASS} NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE; END IF;
    END $$;""")
    for r in (NOBYPASS, BYPASS):
        # Somente o necessário às cinco operações; triggers e has_role já são SECURITY DEFINER.
        c2.sql(f"""GRANT USAGE ON SCHEMA public, app_auth, auth TO {r};
          GRANT EXECUTE ON FUNCTION app_auth.has_role(uuid, public.app_role), auth.uid(), auth.jwt() TO {r};
          GRANT SELECT ON public.epis, public.inventarios, public.inventario_itens TO {r};
          GRANT SELECT, INSERT, UPDATE, DELETE ON public.movimentacoes TO {r};
          GRANT UPDATE ON public.epis, public.inventarios TO {r};""")


def run(owner, op):
    uid, call, check = OPS[op]
    pre = "UPDATE public.inventario_itens SET quantidade_contada=10;" if op == 'finalizar' else ''
    claims = json.dumps({'role': 'authenticated', 'sub': uid})
    q = (f"BEGIN; {pre} ALTER FUNCTION {FUNCS[op]} OWNER TO {owner}; SET LOCAL ROLE authenticated; "
         f"SELECT set_config('request.jwt.claims','{claims}',true); {call}; RESET ROLE; {check}; ROLLBACK;")
    return c2.sql(q, check=False)


class DefinerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        setup_roles()

    @classmethod
    def tearDownClass(cls):
        # Remove roles e grants de teste para não contaminar ACLs comparadas nas regressões.
        for r in (NOBYPASS, BYPASS):
            c2.sql(f"""REVOKE ALL ON public.epis, public.inventarios, public.inventario_itens, public.movimentacoes FROM {r};
              REVOKE EXECUTE ON FUNCTION app_auth.has_role(uuid, public.app_role), auth.uid(), auth.jwt() FROM {r};
              REVOKE USAGE ON SCHEMA public, app_auth, auth FROM {r}; DROP ROLE {r};""")

    def test_01_replay_owner_attributes(self):
        attrs = c2.sql("SELECT rolsuper, rolbypassrls, (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid) FROM pg_roles r WHERE rolname='lovable'").stdout.strip()
        print(f"\nlovable (owner no replay): super|bypassrls|memberships = {attrs}")
        self.assertTrue(attrs.startswith('t|t'), 'Esperado owner superuser no replay local')
        owners = c2.sql("SELECT string_agg(DISTINCT pg_get_userbyid(proowner), ',') FROM pg_proc WHERE oid IN (" + ','.join(f"'{f}'::regprocedure" for f in FUNCS.values()) + ")").stdout.strip()
        self.assertEqual(owners, 'lovable')

    def test_02_test_roles_are_restricted(self):
        for r, bypass in ((NOBYPASS, 'f'), (BYPASS, 't')):
            self.assertEqual(c2.sql(f"SELECT rolsuper::text||rolbypassrls::text||rolcanlogin::text||rolinherit::text FROM pg_roles WHERE rolname='{r}'").stdout.strip(), f"false{'true' if bypass=='t' else 'false'}falsefalse")
            self.assertEqual(c2.sql(f"SELECT has_table_privilege('{r}','public.auditoria','INSERT')::text||has_table_privilege('{r}','public.user_roles','UPDATE')::text").stdout.strip(), 'falsefalse')

    def test_03_production_like_owner_nosuper_bypassrls(self):
        """Owner equivalente ao catálogo operacional (rolsuper=false, rolbypassrls=true)."""
        for op in OPS:
            with self.subTest(op=op):
                r = run(BYPASS, op)
                self.assertEqual(r.returncode, 0, r.stderr)

    def test_04_owner_without_bypassrls_documented(self):
        """Sem BYPASSRLS: registra o resultado observado; não é um defeito do patch C2.4."""
        results = {}
        for op in OPS:
            r = run(NOBYPASS, op)
            results[op] = 'OK' if r.returncode == 0 else 'FALHA: ' + (r.stderr.strip().splitlines() or ['?'])[0][:140]
        print('\nOwner NOSUPERUSER NOBYPASSRLS:')
        for k, v in results.items():
            print(f'  {k}: {v}')
        (c2.DIR / 'definer_nobypass.json').write_text(json.dumps(results, indent=2))

    def test_05_ownership_restored(self):
        owners = c2.sql("SELECT string_agg(DISTINCT pg_get_userbyid(proowner), ',') FROM pg_proc WHERE oid IN (" + ','.join(f"'{f}'::regprocedure" for f in FUNCS.values()) + ")").stdout.strip()
        self.assertEqual(owners, 'lovable')


if __name__ == '__main__':
    unittest.main(verbosity=2)
