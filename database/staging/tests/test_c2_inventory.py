"""C2.6 / Etapa 4: inventário — funcional e concorrência real (somente socket local).

Concorrência: cada sessão é um processo psql independente (backend próprio).
A prova de bloqueio é pg_blocking_pids()/pg_stat_activity/pg_locks consultados por
uma terceira conexão; o polling apenas espera o motor reportar o bloqueio.
"""
import json
import queue
import subprocess
import sys
import threading
import time
import unittest
import uuid
sys.dont_write_bytecode = True
import test_c2 as c2

PATCH = c2.ROOT / 'database/staging/c2_corrections/04_inventario_concurrency.sql'
EVIDENCE = c2.DIR / 'c2_6_evidence.jsonl'
EPI1 = 'd0000000-0000-0000-0000-000000000001'
EPI2 = 'd0000000-0000-0000-0000-000000000002'
EPI3 = 'd0000000-0000-0000-0000-000000000003'
LUVA = 'd0000000-0000-0000-0000-000000000004'
GLASSES = 'd0000000-0000-0000-0000-000000000005'
COLAB4 = 'c0000000-0000-0000-0000-000000000004'
MISSING = '90000000-0000-0000-0000-0000000000aa'
FIN = "public.finalizar_inventario('{0}','{1}')"


def val(q):
    return c2.sql(q).stdout.strip()


def stock(epi):
    return int(val(f"SELECT estoque_atual FROM public.epis WHERE id='{epi}'"))


def new_inv(items, status='em_andamento'):
    """items: [(epi, sistema, contada|None)]; criado e confirmado pelo superusuário local."""
    inv = str(uuid.uuid4())
    vals = ','.join(f"('{inv}','{e}',{s},{'NULL' if c is None else c})" for e, s, c in items)
    q = f"INSERT INTO public.inventarios(id,local,responsavel) VALUES ('{inv}','C2.6 {inv[:8]}','{c2.ADMIN}');"
    if items:
        q += f"INSERT INTO public.inventario_itens(inventario_id,epi_id,quantidade_sistema,quantidade_contada) VALUES {vals};"
    if status == 'finalizado':
        q += f"UPDATE public.inventarios SET status='finalizado', data_fim=now() WHERE id='{inv}';"
    c2.sql(q)
    return inv


def adjustments(inv):
    return json.loads(val(f"""SELECT coalesce(json_agg(json_build_object('tipo',tipo::text,'epi',epi_id,'q',quantidade,
      'motivo',motivo,'obs',observacao,'autor',usuario_responsavel) ORDER BY epi_id),'[]')
      FROM public.movimentacoes WHERE observacao = (SELECT 'Inventário "'||local||'"' FROM public.inventarios WHERE id='{inv}')"""))


def evidence(record):
    line = json.dumps(record, ensure_ascii=False, default=str)
    print('EVIDENCIA', line, flush=True)
    with EVIDENCE.open('a') as fh:
        fh.write(line + '\n')


class Session:
    """Sessão psql persistente; erros não abortam o processo (ON_ERROR_STOP=0)."""
    def __init__(self, name):
        args = [a if a != 'ON_ERROR_STOP=1' else 'ON_ERROR_STOP=0' for a in c2.PSQL]
        self.name = f'c2_6_{name}'
        self.p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  env=c2.ENV, text=True, bufsize=1)
        self.q = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()
        self.k = 0
        self.run(f"SET application_name='{self.name}'; SET statement_timeout='30s'")
        self.pid = int(self.run('SELECT pg_backend_pid()').strip())

    def _read(self):
        for line in self.p.stdout:
            self.q.put(line)

    def send(self, query):
        self.k += 1
        self.p.stdin.write(query.rstrip().rstrip(';') + ';\n\\echo __C26_END_%d__\n' % self.k)
        self.p.stdin.flush()
        return self.k

    def wait(self, k, timeout=40):
        out, marker, end = [], '__C26_END_%d__' % k, time.monotonic() + timeout
        while True:
            line = self.q.get(timeout=max(0.1, end - time.monotonic()))
            if line.strip() == marker:
                return ''.join(out)
            out.append(line)

    def run(self, query):
        return self.wait(self.send(query))

    def begin_as(self, uid):
        claims = json.dumps({'role': 'authenticated', 'sub': uid})
        self.run(f"BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{claims}',true)")

    def close(self):
        try:
            self.p.stdin.write('ROLLBACK;\n\\q\n'); self.p.stdin.flush()
            self.p.wait(timeout=10)
        except Exception:
            self.p.kill()


def sqlstate(output):
    for line in output.splitlines():
        if line.startswith('ERROR:'):
            return line.split(':')[1].strip()
    return None


def wait_blocked(victim, blocker, timeout=15):
    """Espera o motor reportar victim bloqueado por blocker; devolve a evidência do catálogo."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        row = json.loads(val(f"""SELECT json_build_object('pid',a.pid,'app',a.application_name,
          'blocking',pg_blocking_pids(a.pid),'wait_event_type',a.wait_event_type,'wait_event',a.wait_event,
          'state',a.state,'query',left(a.query,120),
          'locks_waiting',(SELECT coalesce(json_agg(json_build_object('locktype',l.locktype,'mode',l.mode,
             'relation',l.relation::regclass::text,'transactionid',l.transactionid::text)),'[]')
             FROM pg_locks l WHERE l.pid=a.pid AND NOT l.granted))
          FROM pg_stat_activity a WHERE a.pid={victim.pid}"""))
        if blocker.pid in (row['blocking'] or []):
            row['blocker_pid'] = blocker.pid
            row['blocker_app'] = blocker.name
            return row
        time.sleep(0.02)
    raise AssertionError(f'{victim.name} não foi bloqueado por {blocker.name}')


class InventoryFunctional(unittest.TestCase):
    def deny(self, result, state):
        self.assertNotEqual(result.returncode, 0, 'Operação proibida foi aceita')
        self.assertIn(state, result.stderr, result.stderr)

    def test_01_item_writes_in_progress(self):
        inv = new_inv([(EPI1, 5, None)])
        q = (f"INSERT INTO public.inventario_itens(inventario_id,epi_id,quantidade_sistema) VALUES ('{inv}','{EPI2}',3);"
             f"UPDATE public.inventario_itens SET quantidade_contada=4 WHERE inventario_id='{inv}' AND epi_id='{EPI1}';"
             f"DELETE FROM public.inventario_itens WHERE inventario_id='{inv}' AND epi_id='{EPI2}';"
             f"SELECT count(*)||'|'||sum(quantidade_contada) FROM public.inventario_itens WHERE inventario_id='{inv}'")
        for uid in (c2.ADMIN, c2.TECH, c2.ALMOX):
            with self.subTest(uid=uid):
                self.assertEqual(c2.as_user(uid, q).stdout.strip().splitlines()[-1], '1|4')

    def test_02_item_writes_rejected_when_finalized(self):
        inv = new_inv([(EPI1, 5, 5)], 'finalizado')
        for q in (f"INSERT INTO public.inventario_itens(inventario_id,epi_id,quantidade_sistema) VALUES ('{inv}','{EPI2}',1)",
                  f"UPDATE public.inventario_itens SET quantidade_contada=9 WHERE inventario_id='{inv}'",
                  f"DELETE FROM public.inventario_itens WHERE inventario_id='{inv}'"):
            with self.subTest(q=q[:20]):
                self.deny(c2.as_user(c2.ADMIN, q, check=False), '23514')
        self.assertEqual(val(f"SELECT quantidade_contada FROM public.inventario_itens WHERE inventario_id='{inv}'"), '5')

    def test_03_transfer_between_inventories(self):
        a, b = new_inv([(EPI1, 5, None)]), new_inv([])
        fin = new_inv([], 'finalizado')
        move = "UPDATE public.inventario_itens SET inventario_id='{1}' WHERE inventario_id='{0}'"
        self.assertEqual(c2.as_user(c2.TECH, move.format(a, b) + f"; SELECT count(*) FROM public.inventario_itens WHERE inventario_id='{b}'").stdout.strip().splitlines()[-1], '1')
        self.deny(c2.as_user(c2.TECH, move.format(a, fin), check=False), '23514')
        src_fin = new_inv([(EPI2, 1, 1)], 'finalizado')
        self.deny(c2.as_user(c2.TECH, move.format(src_fin, b), check=False), '23514')

    def test_04_missing_header(self):
        self.deny(c2.as_user(c2.ADMIN, f"INSERT INTO public.inventario_itens(inventario_id,epi_id,quantidade_sistema) VALUES ('{MISSING}','{EPI1}',1)", check=False), '23503')
        self.deny(c2.as_user(c2.ADMIN, 'SELECT ' + FIN.format(MISSING, c2.ADMIN), check=False), 'P0002')
        self.deny(c2.as_user(c2.ADMIN, f"SELECT public.excluir_inventario('{MISSING}')", check=False), 'P0002')
        a = new_inv([(EPI1, 5, None)])
        self.deny(c2.as_user(c2.ADMIN, f"UPDATE public.inventario_itens SET inventario_id='{MISSING}' WHERE inventario_id='{a}'", check=False), '23503')

    def test_05_positive_negative_zero_and_uncounted(self):
        base = {e: stock(e) for e in (EPI1, EPI2, EPI3, LUVA)}
        inv = new_inv([(EPI1, 5, 8), (EPI2, 6, 2), (EPI3, 4, 4), (LUVA, 7, None)])
        out = c2.sql(f"""BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{{"role":"authenticated","sub":"{c2.TECH}"}}',true);
          SELECT {FIN.format(inv, c2.ADMIN2)}; COMMIT;""")
        self.assertEqual(out.returncode, 0)
        adj = adjustments(inv)
        local = val(f"SELECT local FROM public.inventarios WHERE id='{inv}'")
        self.assertEqual(adj, [
            {'tipo': 'ajuste_entrada', 'epi': EPI1, 'q': 3, 'motivo': 'Ajuste de inventário', 'obs': f'Inventário "{local}"', 'autor': c2.TECH},
            {'tipo': 'ajuste_saida', 'epi': EPI2, 'q': 4, 'motivo': 'Ajuste de inventário', 'obs': f'Inventário "{local}"', 'autor': c2.TECH}])
        self.assertEqual({e: stock(e) for e in base}, {EPI1: base[EPI1] + 3, EPI2: base[EPI2] - 4, EPI3: base[EPI3], LUVA: base[LUVA]})
        self.assertEqual(val(f"SELECT status||'|'||(data_fim IS NOT NULL) FROM public.inventarios WHERE id='{inv}'"), 'finalizado|true')
        # Item sem contagem preservado como NULL (contagem parcial não é zerada).
        self.assertEqual(val(f"SELECT coalesce(quantidade_contada::text,'NULL') FROM public.inventario_itens WHERE inventario_id='{inv}' AND epi_id='{LUVA}'"), 'NULL')

    def test_06_second_finalization_rejected(self):
        inv = new_inv([(EPI1, 1, 2)])
        c2.sql(f"""BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{{"role":"authenticated","sub":"{c2.ADMIN}"}}',true); SELECT {FIN.format(inv, c2.ADMIN)}; COMMIT;""")
        before = (stock(EPI1), len(adjustments(inv)))
        self.deny(c2.as_user(c2.ADMIN, 'SELECT ' + FIN.format(inv, c2.ADMIN), check=False), '22000')
        self.assertEqual((stock(EPI1), len(adjustments(inv))), before)

    def test_07_delete_in_progress_and_cascade(self):
        inv = new_inv([(EPI1, 1, None), (EPI2, 1, 3)])
        st = (stock(EPI1), stock(EPI2))
        movs = val('SELECT count(*) FROM public.movimentacoes')
        out = c2.sql(f"""BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{{"role":"authenticated","sub":"{c2.ADMIN}"}}',true); SELECT public.excluir_inventario('{inv}'); COMMIT;""")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(val(f"SELECT (SELECT count(*) FROM public.inventarios WHERE id='{inv}')||'|'||(SELECT count(*) FROM public.inventario_itens WHERE inventario_id='{inv}')"), '0|0')
        self.assertEqual((stock(EPI1), stock(EPI2)), st)
        self.assertEqual(val('SELECT count(*) FROM public.movimentacoes'), movs)
        # Cascata direta pelo cabeçalho (FK ON DELETE CASCADE) continua funcionando com o sentinela.
        inv2 = new_inv([(EPI1, 1, None)])
        c2.sql(f"DELETE FROM public.inventarios WHERE id='{inv2}'")
        self.assertEqual(val(f"SELECT count(*) FROM public.inventario_itens WHERE inventario_id='{inv2}'"), '0')

    def test_08_delete_finalized_rejected(self):
        inv = new_inv([(EPI1, 1, 1)], 'finalizado')
        self.deny(c2.as_user(c2.ADMIN, f"SELECT public.excluir_inventario('{inv}')", check=False), '22000')
        self.assertEqual(val(f"SELECT count(*) FROM public.inventario_itens WHERE inventario_id='{inv}'"), '1')

    def test_09_authorization_by_profile(self):
        inv = new_inv([(EPI1, 1, 2)])
        for uid in (c2.LIDER, c2.NO_ROLE, c2.UNKNOWN):
            with self.subTest(finalize=uid):
                self.deny(c2.as_user(uid, 'SELECT ' + FIN.format(inv, c2.ADMIN), check=False), '42501')
        for uid in (c2.TECH, c2.ALMOX, c2.LIDER, c2.NO_ROLE, c2.UNKNOWN):
            with self.subTest(delete=uid):
                self.deny(c2.as_user(uid, f"SELECT public.excluir_inventario('{inv}')", check=False), '42501')
        for uid in (c2.ADMIN, c2.TECH, c2.ALMOX):
            with self.subTest(allowed=uid):
                c2.as_user(uid, 'SELECT ' + FIN.format(inv, c2.UNKNOWN))
        c2.as_user(c2.ADMIN, f"SELECT public.excluir_inventario('{inv}')")

    def test_10_missing_identity(self):
        inv = new_inv([(EPI1, 1, 2)])
        for role in ('authenticated', 'anon', 'service_role'):
            with self.subTest(role=role):
                self.deny(c2.as_user(None, 'SELECT ' + FIN.format(inv, c2.ADMIN), role, check=False), '42501')
                self.deny(c2.as_user(None, f"SELECT public.excluir_inventario('{inv}')", role, check=False), '42501')
        self.assertEqual(val(f"SELECT status FROM public.inventarios WHERE id='{inv}'"), 'em_andamento')

    def test_11_reapply_patch_idempotent(self):
        q = """SELECT json_agg(json_build_object('oid',p.oid,'acl',p.proacl::text,'owner',p.proowner,'src',md5(p.prosrc),'cfg',p.proconfig) ORDER BY p.proname)
               FROM pg_proc p WHERE p.proname IN ('finalizar_inventario','excluir_inventario','trg_validar_inventario_item_status')"""
        before = (val(q), val("SELECT count(*) FROM pg_trigger WHERE tgname='trg_validar_inventario_item_status'"))
        r = subprocess.run(c2.PSQL + ['-f', str(PATCH)], env=c2.ENV, text=True, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((val(q), val("SELECT count(*) FROM pg_trigger WHERE tgname='trg_validar_inventario_item_status'")), before)
        self.assertEqual(before[1], '1')

    def test_12_contracts_and_grants(self):
        self.assertEqual(val("SELECT pg_get_function_identity_arguments('public.finalizar_inventario(uuid,uuid)'::regprocedure)"), 'p_inventario_id uuid, p_usuario uuid')
        self.assertEqual(val("SELECT pg_get_function_identity_arguments('public.excluir_inventario(uuid)'::regprocedure)"), 'p_inventario_id uuid')
        for fn in ('public.finalizar_inventario(uuid,uuid)', 'public.excluir_inventario(uuid)'):
            with self.subTest(fn=fn):
                self.assertEqual(val(f"SELECT has_function_privilege('authenticated','{fn}','EXECUTE')||'|'||has_function_privilege('anon','{fn}','EXECUTE')"), 'true|false')
        self.assertEqual(val("SELECT has_function_privilege('authenticated','public.trg_validar_inventario_item_status()','EXECUTE')"), 'f')

    def test_13_patch_rejects_wrong_database(self):
        c2.sql("DROP DATABASE IF EXISTS c2_wrong_target"); c2.sql("CREATE DATABASE c2_wrong_target")
        try:
            args = [a if a != 'epi_c2_staging' else 'c2_wrong_target' for a in c2.PSQL]
            r = subprocess.run(args + ['-f', str(PATCH)], env=c2.ENV, text=True, capture_output=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('fora da lista de permissões', r.stderr)
        finally:
            c2.sql("DROP DATABASE c2_wrong_target")


class InventoryConcurrency(unittest.TestCase):
    def setUp(self):
        self.sessions = []

    def tearDown(self):
        for s in self.sessions:
            s.close()

    def s(self, name):
        x = Session(name); self.sessions.append(x); return x

    def record(self, scenario, block, outputs, result):
        evidence({'cenario': scenario, 'bloqueio': block,
                  'sqlstates': {k: sqlstate(v) for k, v in outputs.items()}, 'resultado': result})
        for k, v in outputs.items():
            self.assertNotIn('40P01', v, f'deadlock em {scenario}/{k}')
            self.assertNotIn('57014', v, f'timeout em {scenario}/{k}')

    def test_c1a_autosave_then_finalize(self):
        inv = new_inv([(EPI1, 5, 5)]); base = stock(EPI1)
        a, b = self.s('autosave'), self.s('finaliza')
        a.begin_as(c2.TECH)
        oa = a.run(f"UPDATE public.inventario_itens SET quantidade_contada=9 WHERE inventario_id='{inv}'")
        b.begin_as(c2.ADMIN); k = b.send('SELECT ' + FIN.format(inv, c2.ADMIN))
        block = wait_blocked(b, a)
        oa += a.run('COMMIT'); ob = b.wait(k) + b.run('COMMIT')
        self.assertIsNone(sqlstate(oa)); self.assertIsNone(sqlstate(ob))
        # A finalização acordada leu a contagem confirmada pelo autosave.
        self.assertEqual([x['q'] for x in adjustments(inv)], [4]); self.assertEqual(stock(EPI1), base + 4)
        self.record('1a autosave antes da finalização', block, {'autosave': oa, 'finaliza': ob}, 'finalização esperou e aplicou contagem confirmada (+4)')

    def test_c1b_finalize_then_autosave(self):
        inv = new_inv([(EPI1, 5, 6)]); base = stock(EPI1)
        a, b = self.s('finaliza'), self.s('autosave')
        a.begin_as(c2.ADMIN); oa = a.run('SELECT ' + FIN.format(inv, c2.ADMIN))
        b.begin_as(c2.TECH); k = b.send(f"UPDATE public.inventario_itens SET quantidade_contada=99 WHERE inventario_id='{inv}'")
        block = wait_blocked(b, a)
        oa += a.run('COMMIT'); ob = b.wait(k); b.run('ROLLBACK')
        self.assertEqual(sqlstate(ob), '23514')
        self.assertEqual(val(f"SELECT quantidade_contada FROM public.inventario_itens WHERE inventario_id='{inv}'"), '6')
        self.assertEqual(stock(EPI1), base + 1)
        self.record('1b finalização antes do autosave', block, {'finaliza': oa, 'autosave': ob}, 'autosave tardio rejeitado 23514; contagem fechada preservada')

    def test_c2a_autosave_then_delete(self):
        inv = new_inv([(EPI1, 5, None)])
        a, b = self.s('autosave'), self.s('exclui')
        a.begin_as(c2.TECH); oa = a.run(f"UPDATE public.inventario_itens SET quantidade_contada=3 WHERE inventario_id='{inv}'")
        b.begin_as(c2.ADMIN); k = b.send(f"SELECT public.excluir_inventario('{inv}')")
        block = wait_blocked(b, a)
        oa += a.run('COMMIT'); ob = b.wait(k) + b.run('COMMIT')
        self.assertIsNone(sqlstate(ob))
        self.assertEqual(val(f"SELECT (SELECT count(*) FROM public.inventarios WHERE id='{inv}')+(SELECT count(*) FROM public.inventario_itens WHERE inventario_id='{inv}')"), '0')
        self.record('2a autosave antes da exclusão', block, {'autosave': oa, 'exclui': ob}, 'exclusão esperou o autosave e removeu cabeçalho e itens')

    def test_c2b_delete_then_autosave_insert(self):
        inv = new_inv([(EPI1, 5, None)])
        a, b, c = self.s('exclui'), self.s('autosave_upd'), self.s('autosave_ins')
        a.begin_as(c2.ADMIN); oa = a.run(f"SELECT public.excluir_inventario('{inv}')")
        b.begin_as(c2.TECH); kb = b.send(f"UPDATE public.inventario_itens SET quantidade_contada=3 WHERE inventario_id='{inv}'")
        c.begin_as(c2.TECH); kc = c.send(f"INSERT INTO public.inventario_itens(inventario_id,epi_id,quantidade_sistema) VALUES ('{inv}','{EPI2}',1)")
        blocks = [wait_blocked(b, a), wait_blocked(c, a)]
        oa += a.run('COMMIT'); ob = b.wait(kb) + b.run('COMMIT'); oc = c.wait(kc); c.run('ROLLBACK')
        self.assertIsNone(sqlstate(ob))  # UPDATE tardio encontra a linha já removida: 0 linhas, sem erro
        self.assertEqual(sqlstate(oc), '23503')
        self.assertEqual(val(f"SELECT count(*) FROM public.inventario_itens WHERE inventario_id='{inv}'"), '0')
        self.record('2b exclusão antes do autosave (UPDATE e INSERT)', blocks, {'exclui': oa, 'upd': ob, 'ins': oc}, 'UPDATE tardio sem efeito; INSERT tardio rejeitado 23503; sem órfãos')

    def test_c3_double_finalize(self):
        inv = new_inv([(EPI1, 5, 7)]); base = stock(EPI1)
        a, b = self.s('finaliza1'), self.s('finaliza2')
        a.begin_as(c2.ADMIN); oa = a.run('SELECT ' + FIN.format(inv, c2.ADMIN))
        b.begin_as(c2.TECH); k = b.send('SELECT ' + FIN.format(inv, c2.TECH))
        block = wait_blocked(b, a)
        oa += a.run('COMMIT'); ob = b.wait(k); b.run('ROLLBACK')
        self.assertEqual(sqlstate(ob), '22000')
        self.assertEqual(len(adjustments(inv)), 1); self.assertEqual(stock(EPI1), base + 2)
        self.record('3 duas finalizações simultâneas', block, {'f1': oa, 'f2': ob}, 'segunda rejeitada 22000; um único ajuste (+2)')

    def _finalize_vs(self, scenario, epi, other_uid, other_sql):
        # Efeito isolado da operação concorrente medido em transação revertida.
        before = stock(epi)
        dry = c2.as_user(other_uid, other_sql + f"; SELECT estoque_atual FROM public.epis WHERE id='{epi}'").stdout.strip().splitlines()[-1]
        delta = int(dry) - before
        inv = new_inv([(epi, before, before + 5)])
        a, b = self.s('finaliza'), self.s('concorrente')
        a.begin_as(c2.ADMIN); oa = a.run('SELECT ' + FIN.format(inv, c2.ADMIN))
        b.begin_as(other_uid); k = b.send(other_sql)
        block = wait_blocked(b, a)
        oa += a.run('COMMIT'); ob = b.wait(k) + b.run('COMMIT')
        self.assertIsNone(sqlstate(oa)); self.assertIsNone(sqlstate(ob), ob)
        self.assertEqual(stock(epi), before + 5 + delta)
        self.record(scenario, block, {'finaliza': oa, 'concorrente': ob}, f'serializado no lock do EPI; estoque {before} -> {before + 5 + delta} (ajuste +5, operação {delta:+d})')

    def test_c4_finalize_vs_multiple_delivery(self):
        q = f"SELECT public.registrar_entrega_multipla('{COLAB4}','[{{\"epi_id\":\"{GLASSES}\",\"quantidade\":1}}]'::jsonb,'C2.6 conc','2026-11-27T10:00:00Z',NULL)"
        self._finalize_vs('4 finalização x entrega múltipla', GLASSES, c2.ALMOX, q)

    def test_c5_finalize_vs_stock_entry(self):
        self._finalize_vs('5 finalização x entrada de estoque', LUVA, c2.ADMIN, c2.entry(None, '4', LUVA))

    def test_c6_finalize_vs_edit_delivery(self):
        q = f"SELECT public.editar_entrega('{c2.MOV}','{EPI1}',3,NULL,'C2.6 conc')"
        self._finalize_vs('6 finalização x edição de entrega', EPI1, c2.ADMIN, q)

    @classmethod
    def tearDownClass(cls):
        log = (c2.DIR / 'postgres.log').read_text(errors='replace')
        evidence({'resumo_log_servidor': {'deadlock_detected': log.count('deadlock detected'),
                                          'statement_timeout': log.count('canceling statement due to statement timeout'),
                                          'lock_timeout': log.count('canceling statement due to lock timeout')}})


if __name__ == '__main__':
    EVIDENCE.write_text('')
    unittest.main(verbosity=2)
