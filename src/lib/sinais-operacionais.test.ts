import { describe, expect, test } from "bun:test";
import { calcularLinha, type ConsumoJanelas } from "./estoque-calc";
import { avaliarSinais, avaliarSinaisEpi, variacaoConsumo, type TipoSinal } from "./sinais-operacionais";

const LEAD = 36;
function entrada(estoque: number, c: Partial<ConsumoJanelas>, opts: { minimo?: number; seg?: number | null; transito?: number; nome?: string } = {}) {
  const cj = { d30: 0, d90: 0, d365: 0, ...c };
  const epi = { id: opts.nome ?? "e1", nome: opts.nome ?? "EPI", estoque_atual: estoque, estoque_minimo: opts.minimo ?? 0, dias_seguranca: opts.seg ?? 0 };
  return { epi, linha: calcularLinha(epi, cj, opts.transito ?? 0, LEAD), leadDias: LEAD };
}
const tipos = (e: ReturnType<typeof entrada>) => avaliarSinaisEpi(e).map((s) => s.tipo);

describe("sinais operacionais", () => {
  test("estoque zerado gera CRITICA e não gera ruptura nem compra", () => {
    const s = avaliarSinaisEpi(entrada(0, { d30: 30, d90: 90, d365: 365 }));
    expect(s[0].tipo).toBe("ESTOQUE_ZERADO");
    expect(s[0].prioridade).toBe("CRITICA");
    expect(s.map((x) => x.tipo)).not.toContain("RISCO_DE_RUPTURA");
    expect(s.map((x) => x.tipo)).not.toContain("COMPRA_NECESSARIA");
  });

  test("cobertura menor que o período sem reposição gera risco de ruptura", () => {
    // 1/dia, estoque 20 → 20 dias < 36
    const s = avaliarSinaisEpi(entrada(20, { d30: 30, d90: 90, d365: 365 }));
    const r = s.find((x) => x.tipo === "RISCO_DE_RUPTURA")!;
    expect(r.prioridade).toBe("ALTA");
    expect(r.detalhe).toBe("20 dias de cobertura para 36 dias até a reposição.");
  });

  test("cobertura igual ao período não gera risco de ruptura", () => {
    expect(tipos(entrada(36, { d30: 30, d90: 90, d365: 365 }))).not.toContain("RISCO_DE_RUPTURA");
  });

  test("compra sugerida > 0 gera compra necessária com o mesmo número", () => {
    const e = entrada(20, { d30: 30, d90: 90, d365: 365 });
    const c = avaliarSinaisEpi(e).find((x) => x.tipo === "COMPRA_NECESSARIA")!;
    expect(e.linha.sugerido).toBe(16);
    expect(c.detalhe).toBe("Necessidade de 16 unidades.");
  });

  test("compra sugerida = 0 não gera compra necessária", () => {
    expect(tipos(entrada(500, { d30: 30, d90: 90, d365: 365 }))).not.toContain("COMPRA_NECESSARIA");
  });

  test("consumo 30% acima da média gera sinal; abaixo de 30% não", () => {
    // histórico 31–365: 335 un → 1/dia. 30d: 39 → 1,3/dia (+30%)
    expect(variacaoConsumo({ d30: 39, d90: 0, d365: 374 })).toBeCloseTo(0.3, 5);
    expect(tipos(entrada(1000, { d30: 39, d90: 100, d365: 374 }))).toContain("CONSUMO_ACIMA_DO_PADRAO");
    expect(tipos(entrada(1000, { d30: 38, d90: 100, d365: 373 }))).not.toContain("CONSUMO_ACIMA_DO_PADRAO");
  });

  test("sem histórico anterior não gera consumo acima do padrão", () => {
    expect(variacaoConsumo({ d30: 50, d90: 50, d365: 50 })).toBeNull();
    expect(tipos(entrada(1000, { d30: 50, d90: 50, d365: 50 }))).not.toContain("CONSUMO_ACIMA_DO_PADRAO");
  });

  test("estoque > 0 sem entregas em 90 dias gera sem movimentação (BAIXA)", () => {
    const s = avaliarSinaisEpi(entrada(10, { d30: 0, d90: 0, d365: 5 }));
    const m = s.find((x) => x.tipo === "SEM_MOVIMENTACAO")!;
    expect(m.prioridade).toBe("BAIXA");
    expect(tipos(entrada(10, { d30: 0, d90: 1, d365: 5 }))).not.toContain("SEM_MOVIMENTACAO");
    expect(tipos(entrada(0, { d90: 0 }))).not.toContain("SEM_MOVIMENTACAO");
  });

  test("valores ausentes (sem consumo, dias_seguranca nulo) são seguros", () => {
    const s = avaliarSinaisEpi(entrada(5, {}, { seg: null }));
    expect(s.map((x) => x.tipo)).toEqual(["SEM_MOVIMENTACAO"]);
    expect(s.every((x) => !String(x.detalhe).includes("NaN"))).toBe(true);
  });

  test("múltiplos sinais legítimos para o mesmo EPI", () => {
    const t = tipos(entrada(20, { d30: 60, d90: 120, d365: 395 }));
    expect(t).toEqual(expect.arrayContaining<TipoSinal>(["RISCO_DE_RUPTURA", "COMPRA_NECESSARIA", "CONSUMO_ACIMA_DO_PADRAO"]));
  });

  test("ordenação: CRITICA > ALTA > MEDIA > BAIXA", () => {
    const lista = avaliarSinais([
      entrada(10, { d365: 5 }, { nome: "A" }),
      entrada(1000, { d30: 60, d90: 120, d365: 395 }, { nome: "B" }),
      entrada(20, { d30: 30, d90: 90, d365: 365 }, { nome: "C" }),
      entrada(0, {}, { nome: "D" }),
    ]);
    expect(lista.map((s) => s.prioridade)).toEqual(["CRITICA", "ALTA", "ALTA", "MEDIA", "BAIXA"]);
    expect(lista[1].tipo).toBe("RISCO_DE_RUPTURA");
  });
});
