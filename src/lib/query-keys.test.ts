// @ts-nocheck -- executado com "bun test" (tipos de bun:test não instalados)
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys, QUERY_DEFAULTS, deveLimparCache } from "./query-keys";

const k = (x: readonly unknown[]) => JSON.stringify(x);

describe("queryKeys", () => {
  test("preserva chaves atuais", () => {
    expect(queryKeys.movimentacoes.entregas365()).toEqual(["compras-movs"]);
    expect(queryKeys.compras.config()).toEqual(["compras-config"]);
    expect(queryKeys.pedidos.todos()).toEqual(["compras-pedidos"]);
  });
  test("inclui parâmetros variáveis", () => {
    expect(queryKeys.compras.ajustes(2026, 11)).toEqual(["compras-ajustes", 2026, 11]);
    expect(queryKeys.movimentacoes.ultimasEntregas(2, "luvas")).toEqual(["ultimas-entregas", 2, "luvas"]);
    expect(k(queryKeys.inventarios.itens("a"))).not.toBe(k(queryKeys.inventarios.itens("b")));
  });
  test("sem colisões entre contratos diferentes", () => {
    const all: string[] = [];
    for (const dom of Object.values(queryKeys))
      for (const f of Object.values(dom)) all.push(k((f as (...a: any[]) => readonly unknown[])("x", 1)));
    expect(new Set(all).size).toBe(all.length);
    expect(k(queryKeys.colaboradores.detalhe("1"))).not.toBe(k(queryKeys.tamanhos.doColaborador("1")));
    expect(k(queryKeys.inventarios.detalhe("1"))).not.toBe(k(queryKeys.inventarios.itens("1")));
  });
});

describe("QueryClient e isolamento", () => {
  test("padrões conservadores", () => {
    expect(QUERY_DEFAULTS).toEqual({ staleTime: 60_000, gcTime: 600_000, refetchOnWindowFocus: false, refetchOnReconnect: true, retry: 1 });
  });
  test("logout limpa o cache", () => {
    expect(deveLimparCache("SIGNED_OUT", "u1", null)).toBe(true);
    const qc = new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS } } });
    qc.setQueryData(queryKeys.epis.todos(), [{ id: 1 }]);
    if (deveLimparCache("SIGNED_OUT", "u1", null)) qc.clear();
    expect(qc.getQueryData(queryKeys.epis.todos())).toBeUndefined();
  });
  test("troca de usuário limpa; mesmo usuário e refresh não limpam", () => {
    expect(deveLimparCache("SIGNED_IN", "u1", "u2")).toBe(true);
    expect(deveLimparCache("SIGNED_IN", "u1", "u1")).toBe(false);
    expect(deveLimparCache("SIGNED_IN", null, "u1")).toBe(false);
    expect(deveLimparCache("TOKEN_REFRESHED", "u1", "u1")).toBe(false);
    expect(deveLimparCache("USER_UPDATED", "u1", "u1")).toBe(false);
  });
});
