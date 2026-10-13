// @ts-nocheck -- executado com "bun test"
import { describe, expect, test } from "bun:test";
import { calcularLinha, DIA_MS } from "./estoque-calc";
import { analisarInteligencia, itemBaseDoTamanho } from "./inteligencia-operacional";

const REF = new Date(2026, 9, 11, 15);
const hoje = new Date(2026, 9, 11).getTime();
const dia = (n: number) => new Date(hoje - n * DIA_MS + 12 * 3600_000).toISOString();
/** n entregas de q unidades distribuídas entre os dias [de, ate) atrás. */
function serie(epi: string, de: number, ate: number, n: number, q = 1) {
  return Array.from({ length: n }, (_, i) => ({ epi_id: epi, quantidade: q, data_movimentacao: dia(de + 1 + Math.floor(((ate - de) * i) / n)) }));
}
const epi = (id: string, o: any = {}) => ({ id, nome: o.nome ?? id, codigo_produto: "C" + id, tamanho: o.tamanho ?? null, estoque_atual: o.estoque ?? 100 });
const run = (epis, entregas, linhas = new Map(), leadDias = 36) => analisarInteligencia({ epis, entregas, linhas, leadDias, ref: REF });
const tipos = (r) => r.map((x) => x.tipo);

describe("inteligência operacional", () => {
  test("aumento de consumo ≥30%", () => {
    const r = run([epi("a")], [...serie("a", 0, 30, 13), ...serie("a", 30, 60, 10)]);
    const i = r.find((x) => x.tipo === "CONSUMO_EM_ALTA");
    expect(i.observado).toBe(13);
    expect(i.comparacao).toBe(10);
    expect(i.variacaoPct).toBeCloseTo(0.3, 5);
  });
  test("queda de consumo ≥30%", () => {
    expect(tipos(run([epi("a")], [...serie("a", 0, 30, 5), ...serie("a", 30, 60, 10)]))).toContain("CONSUMO_EM_QUEDA");
  });
  test("variação abaixo de 30% não gera insight", () => {
    const t = tipos(run([epi("a")], [...serie("a", 0, 30, 12), ...serie("a", 30, 60, 10)]));
    expect(t).not.toContain("CONSUMO_EM_ALTA");
    expect(t).not.toContain("DADOS_INSUFICIENTES");
  });
  test("sem histórico anterior → dados insuficientes, sem variação", () => {
    const r = run([epi("a")], serie("a", 0, 30, 20));
    expect(tipos(r)).toEqual(["DADOS_INSUFICIENTES"]);
    expect(r[0].analise).toBe("variacao");
  });
  test("volume insuficiente (<5 registros) → sem variação", () => {
    const r = run([epi("a")], [...serie("a", 0, 30, 2, 10), ...serie("a", 30, 60, 1, 1)]);
    expect(tipos(r)).toEqual(["DADOS_INSUFICIENTES"]);
  });
  test("tendência persistente vs pico isolado", () => {
    const hist = serie("a", 90, 365, 55); // 0,2/dia
    const persist = [...hist, ...serie("a", 0, 30, 12), ...serie("a", 30, 60, 12), ...serie("a", 60, 90, 12)];
    expect(tipos(run([epi("a")], persist))).toContain("CONSUMO_ELEVADO_PERSISTENTE");
    const pico = [...hist, ...serie("a", 0, 30, 12), ...serie("a", 30, 60, 6), ...serie("a", 60, 90, 6)];
    expect(tipos(run([epi("a")], pico))).not.toContain("CONSUMO_ELEVADO_PERSISTENTE");
  });
  test("estoque depende de pedido em aberto", () => {
    const e = epi("a", { estoque: 20 });
    const linha = calcularLinha({ ...e, estoque_minimo: 0 }, { d30: 30, d90: 90, d365: 365 }, 30, 36);
    const r = run([e], [], new Map([["a", linha]]));
    const i = r.find((x) => x.tipo === "ESTOQUE_DEPENDE_DE_PEDIDO");
    expect(i.observado).toBe(20);
    expect(i.comparacao).toBe(36);
  });
  test("sem pedido em aberto e cobertura curta não duplica o sinal de ruptura", () => {
    const e = epi("a", { estoque: 20 });
    const linha = calcularLinha({ ...e, estoque_minimo: 0 }, { d30: 30, d90: 90, d365: 365 }, 0, 36);
    expect(run([e], [], new Map([["a", linha]]))).toEqual([]);
  });
  test("cobertura excessiva (>4× período)", () => {
    const e = epi("a", { estoque: 200 });
    const linha = calcularLinha({ ...e, estoque_minimo: 0 }, { d30: 30, d90: 90, d365: 365 }, 0, 36);
    expect(tipos(run([e], [], new Map([["a", linha]])))).toEqual(["COBERTURA_EXCESSIVA"]);
  });
  test("concentração por tamanho usa entregas reais", () => {
    const m = epi("m", { nome: "Camisa M", tamanho: "M", estoque: 10 });
    const g = epi("g", { nome: "Camisa G", tamanho: "G", estoque: 90 });
    const r = run([m, g], [...serie("m", 0, 90, 16), ...serie("g", 0, 90, 4)]);
    const i = r.find((x) => x.tipo === "CONCENTRACAO_POR_TAMANHO");
    expect(i.epiId).toBe("m");
    expect(i.observado).toBeCloseTo(0.8, 5);
    expect(i.comparacao).toBeCloseTo(0.1, 5);
  });
  test("tamanho ausente ou que não corresponde ao nome não é inferido", () => {
    expect(itemBaseDoTamanho(epi("x", { nome: "Camisa M" }))).toBeNull();
    expect(itemBaseDoTamanho(epi("x", { nome: "Camisa Azul", tamanho: "M" }))).toBeNull();
    expect(itemBaseDoTamanho(epi("x", { nome: "Bota 42", tamanho: "42" }))).toBe("bota");
    const r = run([epi("m", { nome: "Camisa M" }), epi("g", { nome: "Camisa G" })], serie("m", 0, 90, 20));
    expect(tipos(r)).not.toContain("CONCENTRACAO_POR_TAMANHO");
  });
  test("poucas entregas por tamanho → dados insuficientes", () => {
    const r = run([epi("m", { nome: "Calça M", tamanho: "M" }), epi("g", { nome: "Calça G", tamanho: "G" })], serie("m", 0, 90, 3));
    expect(r.some((x) => x.analise === "tamanho" && x.dadosInsuficientes)).toBe(true);
  });
  test("dados vazios, nulos ou inválidos são seguros", () => {
    expect(analisarInteligencia({ epis: [], entregas: [], linhas: new Map(), leadDias: 36, ref: REF })).toEqual([]);
    const lixo = [
      { epi_id: "a", quantidade: null, data_movimentacao: dia(1) },
      { epi_id: "a", quantidade: 5, data_movimentacao: "invalida" },
      { epi_id: "a", quantidade: -3, data_movimentacao: dia(2) },
      { epi_id: "a", quantidade: 5, data_movimentacao: dia(2), tipo: "troca" },
      null,
    ];
    const r = analisarInteligencia({ epis: [epi("a"), null], entregas: lixo, linhas: undefined, leadDias: 36, ref: REF });
    expect(r).toEqual([]);
  });
});
