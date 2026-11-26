"""C2.4: fronteira por privilégios; SQL real apenas no socket hermético."""
import json
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
import test_c2 as c2

PATCH = c2.ROOT / 'database/staging/c2_corrections/02_epis_grants_movimentacoes.sql'
ALLOWED = ['nome', 'categoria', 'ca', 'modelo', 'tamanho', 'codigo_produto',
           'estoque_minimo', 'custo_unitario', 'dias_seguranca', 'localizacao', 'status']
INV = 'f0000000-0000-0000-0000-000000000001'
COLAB = 'c0000000-0000-0000-0000-000000000001'
EPI2 = 'd0000000-0000-0000-0000-000000000002'
NEW = 'd0000000-0000-0000-0000-000000000099'


def rows(query):
    return json.loads(c2.sql(f"SELECT coalesce(json_agg(t),'[]'::json) FROM ({query}) t").stdout)


def boundary_snapshot():
    result = c2.snapshot()
    result['columns'] = rows("""SELECT c.relname, a.attname, a.attacl::text AS acl
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      WHERE c.oid IN ('public.epis'::regclass,'public.movimentacoes'::regclass)
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum""")
    result['privileges'] = rows("""SELECT r.rolname, c.relname, a.attname,
      has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') AS upd,
      has_column_privilege(r.oid,c.oid,a.attnum,'INSERT') AS ins,
      has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') AS sel,
      has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES') AS ref
      FROM pg_roles r CROSS JOIN pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE r.rolname IN ('authenticated','anon','service_role','lovable')
      AND c.oid IN ('public.epis'::regclass,'public.movimentacoes'::regclass)
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY r.rolname,c.relname,a.attnum""")
    result['table_privileges'] = rows("""SELECT r.rolname,c.relname,v.privilege,
      has_table_privilege(r.oid,c.oid,v.privilege) AS allowed
      FROM pg_roles r CROSS JOIN pg_class c CROSS JOIN
      (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
      WHERE r.rolname IN ('authenticated','anon','service_role','lovable')
      AND c.oid IN ('public.epis'::regclass,'public.movimentacoes'::regclass)
      ORDER BY r.rolname,c.relname,v.privilege""")
    return result


def delivery(items, colab=COLAB, obs='C2 boundary'):
    return f"SELECT public.registrar_entrega_multipla('{colab}','{json.dumps(items)}'::jsonb,'{obs}','2026-11-26T20:11:00Z','{c2.TECH}')"


def insert_mov(uid=c2.ADMIN, kind='entrada_estoque'):
    return f"INSERT INTO public.movimentacoes(tipo,epi_id,quantidade,usuario_responsavel) VALUES ('{kind}','{c2.EPI}',3,'{uid}')"


class BoundaryTests(unittest.TestCase):
    def deny(self, query, uid=c2.ADMIN, role='authenticated', state='42501', metadata=None):
        result = c2.as_user(uid, query, role, check=False, metadata=metadata)
        self.assertNotEqual(result.returncode, 0, 'Escrita proibida foi aceita')
        self.assertIn(state, result.stderr)

    def test_01_authenticated_stock_update_42501(self):
        for uid in (c2.ADMIN, c2.TECH, c2.ALMOX, c2.LIDER, c2.NO_ROLE):
            with self.subTest(uid=uid):
                self.deny(f"UPDATE public.epis SET estoque_atual=999 WHERE id='{c2.EPI}'", uid)

    def test_02_anon_stock_update_42501(self):
        self.deny(f"UPDATE public.epis SET estoque_atual=999 WHERE id='{c2.EPI}'", None, 'anon')

    def test_03_authenticated_mov_insert_all_existing_types(self):
        kinds = rows("SELECT enumlabel AS kind FROM pg_enum WHERE enumtypid='public.movimentacao_tipo'::regtype ORDER BY enumsortorder")
        # Legado devolucao_normal é inspecionado no catálogo, não reinserido.
        self.assertIn('roubo', [r['kind'] for r in kinds])
        for kind in (r['kind'] for r in kinds if r['kind'] != 'devolucao_normal'):
            with self.subTest(kind=kind):
                self.deny(insert_mov(kind=kind))

    def test_04_anon_mov_insert(self):
        self.deny(insert_mov(), None, 'anon')

    def test_05_identity_metadata_and_flags_do_not_grant_privilege(self):
        for uid in (c2.TECH, c2.NO_ROLE):
            self.deny(insert_mov(c2.ADMIN2), uid, metadata={'role': 'admin', 'user_id': c2.ADMIN2})
            self.deny(f"SELECT set_config('app.contexto_estoque_autorizado','true',true); UPDATE public.epis SET estoque_atual=999 WHERE id='{c2.EPI}'", uid)

    def test_06_each_non_allowed_epi_column_denied(self):
        columns = rows("SELECT attname FROM pg_attribute WHERE attrelid='public.epis'::regclass AND attnum>0 AND NOT attisdropped")
        denied = {r['attname'] for r in columns} - set(ALLOWED)
        self.assertEqual(denied, {'id', 'estoque_atual', 'created_at', 'updated_at'})
        for col in sorted(denied):
            with self.subTest(column=col):
                self.deny(f"UPDATE public.epis SET {col}={col} WHERE id='{c2.EPI}'")

    def test_07_exact_effective_column_allowlist(self):
        snap = boundary_snapshot()
        for row in snap['privileges']:
            with self.subTest(role=row['rolname'], table=row['relname'], column=row['attname']):
                if row['rolname'] in ('anon', 'authenticated'):
                    if row['relname'] == 'epis':
                        self.assertEqual(row['upd'], row['rolname']=='authenticated' and row['attname'] in ALLOWED)
                    else:
                        self.assertFalse(row['ins'])

    def test_08_epi_create_exact_frontend_payload_and_initial_entry(self):
        for uid in (c2.ADMIN, c2.TECH):
            c2.as_user(uid, f"""INSERT INTO public.epis(id,nome,categoria,ca,modelo,tamanho,codigo_produto,
              estoque_minimo,custo_unitario,dias_seguranca,localizacao,status,estoque_atual)
              VALUES ('{NEW}','Luva teste','Proteção das mãos','123','Nitrílica','M','C2-099',2,3.50,20,'A','ativo',0);
              {c2.entry(uid, '5', NEW)};
              SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{NEW}'),'5','Cadastro com entrada rastreável');
              RESET ROLE; SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE tabela='epis' AND registro_id='{NEW}' AND usuario_id='{uid}'),'2','Cadastro e entrada auditados')""")

    def test_09_update_exact_frontend_payload_all_allowed_columns(self):
        for uid in (c2.ADMIN, c2.TECH, c2.ALMOX):
            c2.as_user(uid, f"""UPDATE public.epis SET nome='Nome editado',categoria='Categoria teste',ca='987',modelo='Modelo teste',
              tamanho='G',codigo_produto='C2-EDIT',estoque_minimo=3,custo_unitario=4.50,dias_seguranca=21,
              localizacao='B',status='inativo' WHERE id='{c2.EPI}';
              SELECT test.ok(EXISTS(SELECT 1 FROM public.epis WHERE id='{c2.EPI}' AND nome='Nome editado'
                AND categoria='Categoria teste' AND ca='987' AND modelo='Modelo teste' AND tamanho='G'
                AND codigo_produto='C2-EDIT' AND estoque_minimo=3 AND custo_unitario=4.50
                AND dias_seguranca=21 AND localizacao='B' AND status='inativo' AND estoque_atual=8),'Payload completo foi aplicado sem alterar estoque');
              RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.auditoria WHERE registro_id='{c2.EPI}' AND operacao='UPDATE' AND usuario_id='{uid}' AND dados_novos->>'nome'='Nome editado'),'Edição auditada')""")

    def test_10_mixed_payload_no_partial_update_or_audit(self):
        before = boundary_snapshot()['data']
        self.deny(f"UPDATE public.epis SET nome='Não deve persistir',estoque_atual=999 WHERE id='{c2.EPI}'")
        self.assertEqual(boundary_snapshot()['data'], before)

    def test_11_entry_rpc_stock_and_audit(self):
        c2.C2Tests('test_08_entry_legitimate_roles_stock_and_audit').test_08_entry_legitimate_roles_stock_and_audit()

    def test_12_multi_delivery_two_items_and_audit(self):
        glasses = 'd0000000-0000-0000-0000-000000000005'
        c2.as_user(c2.TECH, delivery([{'epi_id': EPI2, 'quantidade': 2}, {'epi_id': glasses, 'quantidade': 1}], 'c0000000-0000-0000-0000-000000000004') + f""";
          SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{EPI2}'),'18','Primeiro item baixado');
          SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{glasses}'),'29','Segundo item baixado');
          RESET ROLE; SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='INSERT' AND usuario_id='{c2.TECH}' AND dados_novos->>'observacao'='C2 boundary'),'2','Duas entregas auditadas')""")

    def test_13_automatic_swap_existing_delivery_path(self):
        c2.as_user(c2.TECH, delivery([{'epi_id': EPI2, 'quantidade': 1}]) + f""";
          SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{c2.EPI}'),'8','Troca não retorna estoque');
          SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{EPI2}'),'19','Nova entrega baixa um');
          RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes WHERE epi_id='{c2.EPI}' AND tipo='troca' AND quantidade=1 AND data_movimentacao='2026-11-26T20:11:00Z'),'Troca automática inserida');
          SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE tabela='movimentacoes' AND operacao='INSERT' AND usuario_id='{c2.TECH}' AND dados_novos->>'data_movimentacao'='2026-11-26T20:11:00+00:00'),'2','Troca e entrega auditadas')""")

    def test_14_delete_rpc_reversal_and_audit(self):
        c2.C2Tests('test_11_delete_legitimate_admin_restores_stock_and_audits').test_11_delete_legitimate_admin_restores_stock_and_audits()

    def test_15_edit_delivery_definer_direct_stock_update(self):
        c2.as_user(c2.ADMIN, f"""SELECT public.editar_entrega('{c2.MOV}','{EPI2}',3,NULL,'C2 edição');
          SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{c2.EPI}'),'10','Estoque antigo restituído');
          SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{EPI2}'),'17','Novo estoque baixado');
          SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes WHERE id='{c2.MOV}' AND epi_id='{EPI2}' AND quantidade=3),'Entrega atualizada');
          SELECT test.ok(EXISTS(SELECT 1 FROM public.auditoria WHERE registro_id='{c2.MOV}' AND operacao='UPDATE' AND usuario_id='{c2.ADMIN}'),'Edição da entrega auditada')""")

    def test_16_inventory_existing_adjustments_and_partial_count(self):
        for counted, balance, kind, qty in ((11, 11, 'ajuste_entrada', 3), (6, 6, 'ajuste_saida', 2)):
            with self.subTest(kind=kind):
                c2.as_user(c2.TECH, f"""UPDATE public.inventario_itens SET quantidade_contada={counted} WHERE inventario_id='{INV}';
                  INSERT INTO public.inventario_itens(inventario_id,epi_id,quantidade_sistema,quantidade_contada) VALUES ('{INV}','{EPI2}',20,NULL);
                  SELECT public.finalizar_inventario('{INV}','{c2.TECH}');
                  SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{c2.EPI}'),'{balance}','Ajuste legado preservado');
                  SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{EPI2}'),'20','Não contado preservado');
                  SELECT test.eq((SELECT status::text FROM public.inventarios WHERE id='{INV}'),'finalizado','Finalização existente funciona');
                  RESET ROLE; SELECT test.ok(EXISTS(SELECT 1 FROM public.movimentacoes m JOIN public.auditoria a ON a.registro_id=m.id WHERE m.tipo='{kind}' AND m.epi_id='{c2.EPI}' AND m.quantidade={qty} AND a.operacao='INSERT' AND a.usuario_id='{c2.TECH}'),'Ajuste auditado')""")

    def test_17_partial_rpc_failure_rolls_back_first_item(self):
        before = boundary_snapshot()['data']
        self.deny(delivery([{'epi_id': EPI2, 'quantidade': 1}, {'epi_id': c2.EPI, 'quantidade': 999}]), c2.TECH, state='P0001')
        self.assertEqual(boundary_snapshot()['data'], before)

    def test_18_function_owner_privileges_and_writer_inventory(self):
        writers = rows("""SELECT p.proname, pg_get_userbyid(p.proowner) AS owner,p.prosecdef,
          has_table_privilege(p.proowner,'public.movimentacoes','INSERT') AS ins,
          has_column_privilege(p.proowner,'public.epis','estoque_atual','UPDATE') AS stock
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
          AND p.prosrc ~* 'INSERT[[:space:]]+INTO[[:space:]]+(public[.])?movimentacoes' ORDER BY p.proname""")
        self.assertEqual(sorted(r['proname'] for r in writers), sorted(['finalizar_inventario','registrar_entrega_atomica','registrar_entrega_multipla','registrar_entrada_estoque']))
        for writer in writers:
            self.assertTrue(writer['prosecdef'])
            self.assertTrue(writer['ins'])
            self.assertTrue(writer['stock'])
        triggers = rows("""SELECT p.proname,p.prosecdef,
          has_column_privilege(p.proowner,'public.epis','estoque_atual','UPDATE') AS stock,
          has_table_privilege(p.proowner,'public.auditoria','INSERT') AS audit
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
          AND p.proname IN ('aplicar_movimentacao_estoque','registrar_auditoria') ORDER BY p.proname""")
        self.assertEqual(len(triggers), 2)
        for trigger in triggers:
            self.assertTrue(trigger['prosecdef'])
            self.assertTrue(trigger['stock'])
            self.assertTrue(trigger['audit'])
        print('WRITERS LOCAIS:', json.dumps(writers, ensure_ascii=False))

    def test_19_catalog_contracts_policies_triggers_unchanged(self):
        before = json.loads((c2.DIR / 'boundary_before.json').read_text())
        after = boundary_snapshot()
        for key in ('functions', 'policies', 'triggers', 'data', 'service_atomic'):
            self.assertEqual(after[key], before[key], key)
        for old, new in zip(before['tables'], after['tables']):
            old, new = dict(old), dict(new)
            if old['relname'] in ('epis', 'movimentacoes'):
                old.pop('acl'); new.pop('acl')
            self.assertEqual(new, old)
        for old, new in zip(before['privileges'], after['privileges']):
            for field in ('sel','ref'):
                self.assertEqual(new[field], old[field])
            if old['rolname'] not in ('authenticated','anon'):
                self.assertEqual(new, old)
            elif old['relname']=='epis':
                self.assertEqual(new['ins'], old['ins'])
        for old, new in zip(before['table_privileges'], after['table_privileges']):
            removed = old['rolname'] in ('authenticated','anon') and (
                (old['relname']=='epis' and old['privilege']=='UPDATE') or
                (old['relname']=='movimentacoes' and old['privilege']=='INSERT'))
            self.assertEqual(new, dict(old, allowed=False) if removed else old)

    def test_20_idempotent_reapplication(self):
        self.assertEqual(boundary_snapshot(), json.loads((c2.DIR / 'boundary_first.json').read_text()))

    def test_21_patch_rejects_wrong_local_database(self):
        args = list(c2.PSQL)
        args[args.index('-d')+1] = 'postgres'
        import subprocess
        result = subprocess.run(args+['-f',str(PATCH)], env=c2.ENV, text=True, capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('conexão fora da lista de permissões local',result.stderr)

    def test_22_column_grants_and_public_cannot_bypass(self):
        # Grants adversariais de tabela/coluna dentro de transação descartável.
        query = f"""BEGIN; GRANT UPDATE ON public.epis TO PUBLIC,anon;
          GRANT UPDATE (estoque_atual,created_at) ON public.epis TO authenticated,anon,PUBLIC;
          GRANT INSERT (tipo,epi_id,quantidade) ON public.movimentacoes TO authenticated,anon,PUBLIC;
          {PATCH.read_text().replace('BEGIN;', '', 1).rsplit('COMMIT;', 1)[0]}
          SELECT test.ok(NOT has_column_privilege('authenticated','public.epis','estoque_atual','UPDATE'),'Grant de coluna removido');
          SELECT test.ok(NOT has_column_privilege('anon','public.epis','created_at','UPDATE'),'Grant PUBLIC removido');
          SELECT test.ok(NOT has_any_column_privilege('authenticated','public.movimentacoes','INSERT'),'INSERT por coluna removido');
          ROLLBACK;"""
        c2.sql(query)

    def test_23_reads_preserved_for_all_authenticated_profiles(self):
        for uid in (c2.ADMIN,c2.TECH,c2.ALMOX,c2.LIDER,c2.NO_ROLE):
            # Política existente requer perfil; usuário sem papel continua sem linhas.
            epis, movs = ('0','0') if uid==c2.NO_ROLE else ('5','3')
            c2.as_user(uid, f"SELECT test.eq((SELECT count(*)::text FROM public.epis),'{epis}','Leitura de EPIs preserva RLS'); SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes),'{movs}','Leitura de movimentos preserva RLS')")

    def test_24_rls_still_limits_allowed_cadastral_columns(self):
        for uid in (c2.LIDER,c2.NO_ROLE):
            c2.as_user(uid, f"UPDATE public.epis SET nome='Não permitido' WHERE id='{c2.EPI}'; RESET ROLE; SELECT test.eq((SELECT nome FROM public.epis WHERE id='{c2.EPI}'),'Camisa M','RLS continua negando edição cadastral')")

    def test_25_inherited_permissions_abort_patch_atomically(self):
        before = boundary_snapshot()
        body = PATCH.read_text().replace('BEGIN;', '', 1).rsplit('COMMIT;', 1)[0]
        for grants in (
            'GRANT service_role TO authenticated;',
            'CREATE ROLE c2_column_writer NOLOGIN; GRANT UPDATE (created_at) ON public.epis TO c2_column_writer; GRANT c2_column_writer TO authenticated;',
        ):
            with self.subTest(grants=grants):
                result = c2.sql(f"BEGIN; {grants} {body} ROLLBACK;", check=False)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('privilégio efetivo incompatível',result.stderr)
                self.assertEqual(boundary_snapshot(),before)

    def test_26_existing_loss_types_via_privileged_legacy_operation(self):
        # Caminho administrativo legado, NÃO chamada permitida a authenticated.
        # A contenção da RPC atômica permanece inalterada.
        for kind in ('perda','roubo','avariado','descarte'):
            with self.subTest(kind=kind):
                c2.sql(f"""BEGIN; SELECT set_config('request.jwt.claims','{{"sub":"{c2.ADMIN}","role":"authenticated"}}',true);
                  SELECT public.registrar_entrega_atomica('{COLAB}','{c2.EPI}',1,'C2 owner','2026-11-26T20:11:00Z','{c2.ADMIN}','{kind}','{c2.EPI}',1,'C2 owner','C2 owner');
                  SELECT test.eq((SELECT estoque_atual::text FROM public.epis WHERE id='{c2.EPI}'),'7','Baixa definitiva não retorna estoque; entrega baixa um');
                  SELECT test.eq((SELECT count(*)::text FROM public.movimentacoes WHERE observacao='C2 owner'),'2','Movimentos internos inseridos');
                  SELECT test.eq((SELECT count(*)::text FROM public.auditoria WHERE tabela='movimentacoes' AND usuario_id='{c2.ADMIN}' AND dados_novos->>'observacao'='C2 owner'),'2','Baixa e entrega auditadas'); ROLLBACK;""")


if __name__=='__main__':
    identity = c2.sql("SELECT current_database(),current_setting('data_directory'),current_setting('port'),inet_server_addr() IS NULL").stdout.strip()
    if identity != 'epi_c2_staging|/tmp/epi-c2-pg/data|55433|t':
        raise SystemExit('C2: destino fora da lista de permissões')
    if len(sys.argv)==2 and sys.argv[1] in ('--snapshot-before','--snapshot-first'):
        suffix = 'before' if sys.argv[1]=='--snapshot-before' else 'first'
        (c2.DIR / f'boundary_{suffix}.json').write_text(json.dumps(boundary_snapshot(),indent=2))
        print('Snapshot Etapa 2:',suffix)
    else:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(BoundaryTests)
        # 19 testes da Etapa 1 repetidos após restrições; teste 02 tem ACL de
        # tabela imutável por contrato da Etapa 1 e é substituído pelo teste 19.
        for name in unittest.defaultTestLoader.getTestCaseNames(c2.C2Tests):
            if name != 'test_02_contracts_and_unchanged_objects':
                suite.addTest(c2.C2Tests(name))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
