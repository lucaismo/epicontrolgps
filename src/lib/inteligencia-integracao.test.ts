// @ts-nocheck -- executado com "bun test"
import { describe, expect, test } from "bun:test";
import { agruparInsights, integrarInteligencia, DESTINO_INSIGHT } from "./inteligencia-integracao";

const ins = (o) => ({ tipo: "CONSUMO_EM_ALTA", prioridade: "MEDIA", epiId: "a", epiCodigo: null, epiNome: "A", periodo: null, observado: 1, comparacao: 1, variacaoPct: null, motivo: "", recomendacao: "", dadosInsuficientes: false, ...o });
const REF = new Date(2026, 9, 11, 15);

describe("integração da inteligência", () => {
  test("agrupa por EPI com a maior prioridade", () => {
    const g = agruparInsights([ins({ prioridade: "BAIXA", tipo: "COBERTURA_EXCESSIVA" }), ins({}), ins({ epiId: "b", epiNome: "B", prioridade: "BAIXA" })]);
    expect(g.length).toBe(2);
    expect(g[0].epiId).toBe("a");
    expect(g[0].prioridade).toBe("MEDIA");
    expect(g[0].insights[0].tipo).toBe("CONSUMO_EM_ALTA");
  });
  test("insights sem epiId agrupam pelo item-base", () => {
    const g = agruparInsights([ins({ epiId: null, epiNome: "camisa" }), ins({ epiId: null, epiNome: "camisa" })]);
    expect(g.length).toBe(1);
  });
  test("todos os sete tipos têm destino", () => {
    expect(Object.keys(DESTINO_INSIGHT).length).toBe(7);
  });
  test("separa dados insuficientes", () => {
    const hoje = new Date(2026, 9, 11).getTime();
    const entregas = Array.from({ length: 3 }, (_, i) => ({ epi_id: "a", quantidade: 1, data_movimentacao: new Date(hoje - (i + 2) * 86400000).toISOString() }));
    const r = integrarInteligencia({ epis: [{ id: "a", nome: "A", estoque_atual: 10 }], entregas, linhas: new Map(), leadDias: 36, ref: REF });
    expect(r.ok).toBe(true);
    expect(r.acionaveis).toEqual([]);
    expect(r.insuficientes.length).toBe(1);
  });
  test("sem movimentações → vazio", () => {
    const r = integrarInteligencia({ epis: [{ id: "a", nome: "A", estoque_atual: 10 }], entregas: [], linhas: new Map(), leadDias: 36, ref: REF });
    expect(r.total).toBe(0);
  });
  test("falha da análise fica isolada", () => {
    const r = integrarInteligencia({ epis: [{ id: "a", nome: "A", estoque_atual: 1 }], entregas: [], get linhas() { throw new Error("x"); }, leadDias: 36 });
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("x");
  });
});
