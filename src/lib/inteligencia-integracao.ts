/** Integração pura da inteligência operacional com a Central: análise segura + agrupamento por EPI. */
import { analisarInteligencia, type EntradaInteligencia, type Insight, type PrioridadeInsight } from "./inteligencia-operacional";

export interface GrupoInsight {
  chave: string;
  epiId: string | null;
  epiNome: string;
  epiCodigo: string | null;
  prioridade: PrioridadeInsight;
  insights: Insight[];
}
export interface ResultadoIntegracao {
  ok: boolean;
  erro: string | null;
  acionaveis: GrupoInsight[];
  insuficientes: GrupoInsight[];
  total: number;
}

const PESO: Record<PrioridadeInsight, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2, INFO: 3 };

export function agruparInsights(insights: Insight[]): GrupoInsight[] {
  const map = new Map<string, GrupoInsight>();
  for (const i of insights) {
    const chave = i.epiId ?? `item:${i.epiNome}`;
    const g = map.get(chave);
    if (g) {
      g.insights.push(i);
      if (PESO[i.prioridade] < PESO[g.prioridade]) g.prioridade = i.prioridade;
    } else map.set(chave, { chave, epiId: i.epiId, epiNome: i.epiNome, epiCodigo: i.epiCodigo, prioridade: i.prioridade, insights: [i] });
  }
  for (const g of map.values()) g.insights.sort((a, b) => PESO[a.prioridade] - PESO[b.prioridade]);
  return [...map.values()].sort((a, b) => PESO[a.prioridade] - PESO[b.prioridade] || a.epiNome.localeCompare(b.epiNome, "pt-BR"));
}

export function integrarInteligencia(inp: EntradaInteligencia): ResultadoIntegracao {
  try {
    const todos = analisarInteligencia(inp);
    return {
      ok: true, erro: null, total: todos.length,
      acionaveis: agruparInsights(todos.filter((i) => !i.dadosInsuficientes)),
      insuficientes: agruparInsights(todos.filter((i) => i.dadosInsuficientes)),
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e), acionaveis: [], insuficientes: [], total: 0 };
  }
}

export const DESTINO_INSIGHT: Record<Insight["tipo"], "/compras" | "/consumo" | "/epis"> = {
  CONSUMO_EM_ALTA: "/consumo", CONSUMO_EM_QUEDA: "/consumo", CONSUMO_ELEVADO_PERSISTENTE: "/consumo",
  ESTOQUE_DEPENDE_DE_PEDIDO: "/compras", COBERTURA_EXCESSIVA: "/compras", CONCENTRACAO_POR_TAMANHO: "/compras",
  DADOS_INSUFICIENTES: "/epis",
};
