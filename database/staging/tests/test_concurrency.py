#!/usr/bin/env python3
"""Testes reais de concorrência no PostgreSQL local; nunca usa o banco Supabase."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import os
import subprocess

ENV = dict(os.environ)
ENV.update({"PGHOST": "/tmp/epi-guard-pg", "PGPORT": "55432", "PGDATABASE": "epi_guard_test"})
ORG = "10000000-0000-0000-0000-000000000001"
ADMIN = "a0000000-0000-0000-0000-000000000001"
COLAB_A = "c0000000-0000-0000-0000-000000000201"
COLAB_B = "c0000000-0000-0000-0000-000000000202"
EPI_A = "d0000000-0000-0000-0000-000000000201"
EPI_B = "d0000000-0000-0000-0000-000000000202"


def psql(sql, user="lovable", check=True):
    result = subprocess.run(
        ["psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-U", user, "-c", sql],
        env=ENV, text=True, capture_output=True,
    )
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result


def auth_prefix():
    return f"""
      SELECT set_config('request.jwt.claims', jsonb_build_object(
        'sub','{ADMIN}','role','authenticated','app_metadata',
        jsonb_build_object('organization_id','{ORG}'))::text, false);
      SET ROLE authenticated;
      SET lock_timeout='5s'; SET statement_timeout='15s';
    """


def scalar(sql):
    return psql(f"SELECT {sql};").stdout.strip().splitlines()[-1].strip()


def multi(colab, epi, when, barrier):
    sql = auth_prefix() + f"""
      SELECT public.registrar_entrega_multipla('{colab}',
        '[{{"epi_id":"{epi}","quantidade":1}}]'::jsonb,
        'Concorrência local', '{when}', '{ADMIN}');
    """
    barrier.wait()
    return psql(sql, check=False)


def atomic(colab, new_epi, old_epi, when, barrier):
    sql = auth_prefix() + f"""
      SELECT public.registrar_entrega_atomica('{colab}', '{new_epi}', 1,
        'Entrega atômica concorrente', '{when}', '{ADMIN}',
        'troca', '{old_epi}', 1, 'Troca concorrente', 'Troca explícita concorrente');
    """
    barrier.wait()
    return psql(sql, check=False)


def assert_processes(processes, label):
    failures = [p.stderr.strip() for p in processes if p.returncode]
    if failures:
        raise RuntimeError(f"{label}: {failures}")
    psql(f"SELECT test.ok(true, '{label}');")


def main():
    psql(auth_prefix() + f"""
      INSERT INTO public.colaboradores (id,nome,matricula,funcao) VALUES
        ('{COLAB_A}','Concorrência A','000201','Operador'),
        ('{COLAB_B}','Concorrência B','000202','Operador');
      INSERT INTO public.epis (id,nome,categoria,tamanho,estoque_atual) VALUES
        ('{EPI_A}','Protetor Concorrente M','Proteção auditiva','M',20),
        ('{EPI_B}','Protetor Concorrente G','Proteção auditiva','G',20);
    """)

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        processes = list(pool.map(
            lambda when: multi(COLAB_A, EPI_A, when, barrier),
            ["2026-03-01T12:00:00Z", "2026-03-01T12:00:01Z"],
        ))
    assert_processes(processes, "Duas entregas concorrentes do mesmo colaborador serializam sem deadlock")
    assert scalar(f"estoque_atual FROM public.epis WHERE id='{EPI_A}'") == "18"
    assert scalar(f"count(*) FROM public.movimentacoes WHERE epi_id='{EPI_A}' AND tipo='entrega'") == "2"
    assert scalar(f"count(*) FROM public.movimentacoes WHERE epi_id='{EPI_A}' AND tipo='troca'") == "1"
    psql("SELECT test.ok(true, 'Corrida no mesmo colaborador preserva duas entregas, uma troca e estoque=18');")

    psql(auth_prefix() + f"""
      SELECT public.registrar_entrega_multipla('{COLAB_B}',
        '[{{"epi_id":"{EPI_B}","quantidade":1}}]'::jsonb,
        'Saldo inicial B', '2026-03-02T12:00:00Z', '{ADMIN}');
    """)

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(atomic, COLAB_A, EPI_B, EPI_A, "2026-03-03T12:00:00Z", barrier),
            pool.submit(atomic, COLAB_B, EPI_A, EPI_B, "2026-03-03T12:00:01Z", barrier),
        ]
        processes = [f.result() for f in futures]
    assert_processes(processes, "Dois pares de EPIs em ordem inversa concluem sem deadlock")
    assert scalar(f"estoque_atual FROM public.epis WHERE id='{EPI_A}'") == "17"
    assert scalar(f"estoque_atual FROM public.epis WHERE id='{EPI_B}'") == "18"
    assert scalar(f"""COALESCE(SUM(CASE WHEN tipo='entrega' THEN quantidade
      WHEN tipo IN ('troca','devolucao_normal','avariado','descarte','perda','roubo') THEN -quantidade ELSE 0 END),0)
      FROM public.movimentacoes WHERE colaborador_id='{COLAB_A}' AND epi_id='{EPI_A}'""") == "0"
    assert scalar(f"""COALESCE(SUM(CASE WHEN tipo='entrega' THEN quantidade
      WHEN tipo IN ('troca','devolucao_normal','avariado','descarte','perda','roubo') THEN -quantidade ELSE 0 END),0)
      FROM public.movimentacoes WHERE colaborador_id='{COLAB_B}' AND epi_id='{EPI_B}'""") == "0"
    psql("SELECT test.ok(true, 'Locks canônicos preservam estoque 17/18 e posse após ordem inversa');")
    print("Concorrência: 4 asserções aprovadas")


if __name__ == "__main__":
    main()
