/**
 * Motor determinístico de sinais operacionais (P2.1).
 *
 * Módulo puro: recebe dados já calculados pelo motor único (estoque-calc.ts)
 * e devolve sinais estruturados. Não refaz nenhuma fórmula de estoque,
 * consumo, cobertura, mínimo ou compra.
 */
import { calcularLinha, DIA_MS, type ConsumoJanelas } from "./estoque-calc";

export type TipoSinal =
  | "ESTOQUE_ZERADO"
  | "RISCO_DE_RUPTURA"
  | "COMPRA_NECESSARIA"
  | "CONSUMO_ACIMA_DO_PADRAO"
  | "SEM_MOVIMENTACAO";

export type PrioridadeSinal = "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";

export type AcaoSinal = "Comprar" | "Ver compra" | "Ver consumo" | "Ver EPI";

export interface SinalOperacional {
  tipo: TipoSinal;
  prioridade: PrioridadeSinal;
  mensagem: string;
  detalhe: string | null;
  acao: AcaoSinal;
  epiId: string;
  epiNome: string;
}

export const PRIORIDADE_PESO: Record<PrioridadeSinal, number> = {
  CRITICA: 0,
  ALTA: 1,
  MEDIA: 2,
  BAIXA: 3,
};

/** Desempate dentro da mesma prioridade (zerado acima de ruptura etc.). */
const TIPO_PESO: Record<TipoSinal, number> = {
  ESTOQUE_ZERADO: 0,
  RISCO_DE_RUPTURA: 1,
  COMPRA_NECESSARIA: 2,
  CONSUMO_ACIMA_DO_PADRAO: 3,
  SEM_MOVIMENTACAO: 4,
};

/** Limite para "consumo acima do padrão": atual ≥ média × 1,3. */
export const LIMIAR_CONSUMO_ACIMA = 0.3;

/** Saída de calcularLinha (mesma linha usada por Compras, EPIs e Central). */
export type LinhaCalculada = ReturnType<typeof calcularLinha>;

export interface EntradaSinal {
  epi: { id: string; nome: string; estoque_atual: number };
  linha: LinhaCalculada;
  /** Período sem reposição (calcLeadTime().dias). */
  leadDias: number;
}

const fmt = (n: number) => Math.floor(n).toLocaleString("pt-BR");

/**
 * Consumo atual (últimos 30 dias) vs. média diária do histórico anterior
 * disponível (dias 31–365). Retorna null sem histórico suficiente.
 */
export function variacaoConsumo(c: ConsumoJanelas): number | null {
  const historico = c.d365 - c.d30;
  if (!(historico > 0)) return null;
  const mediaDiaria = historico / (365 - 30);
  const atualDiario = c.d30 / 30;
  return (atualDiario - mediaDiaria) / mediaDiaria;
}

/** Avalia os sinais de um EPI a partir da linha já calculada. */
export function avaliarSinaisEpi({ epi, linha, leadDias }: EntradaSinal): SinalOperacional[] {
  const base = { epiId: epi.id, epiNome: epi.nome };
  const out: SinalOperacional[] = [];
  const zerado = epi.estoque_atual === 0;

  if (zerado) {
    out.push({ ...base, tipo: "ESTOQUE_ZERADO", prioridade: "CRITICA", mensagem: "Estoque zerado", detalhe: null, acao: "Comprar" });
  } else if (Number.isFinite(linha.cobertura) && linha.cobertura < leadDias) {
    out.push({
      ...base,
      tipo: "RISCO_DE_RUPTURA",
      prioridade: "ALTA",
      mensagem: "Risco de ruptura antes da reposição",
      detalhe: `${fmt(linha.cobertura)} dias de cobertura para ${leadDias} dias até a reposição.`,
      acao: "Comprar",
    });
  }

  if (!zerado && linha.sugerido > 0) {
    out.push({
      ...base,
      tipo: "COMPRA_NECESSARIA",
      prioridade: "ALTA",
      mensagem: "Compra necessária",
      detalhe: `Necessidade de ${fmt(linha.sugerido)} unidades.`,
      acao: "Ver compra",
    });
  }

  const v = variacaoConsumo(linha.c);
  if (v !== null && v >= LIMIAR_CONSUMO_ACIMA) {
    out.push({
      ...base,
      tipo: "CONSUMO_ACIMA_DO_PADRAO",
      prioridade: "MEDIA",
      mensagem: "Consumo acima do padrão",
      detalhe: `Consumo atual ${Math.round(v * 100)}% acima da média.`,
      acao: "Ver consumo",
    });
  }

  // Período analisado: 90 dias (mesma janela principal do consumo diário).
  if (epi.estoque_atual > 0 && linha.c.d90 === 0) {
    out.push({ ...base, tipo: "SEM_MOVIMENTACAO", prioridade: "BAIXA", mensagem: "Sem movimentação recente", detalhe: null, acao: "Ver EPI" });
  }

  return out;
}

export function ordenarSinais(sinais: SinalOperacional[]): SinalOperacional[] {
  return [...sinais].sort(
    (a, b) =>
      PRIORIDADE_PESO[a.prioridade] - PRIORIDADE_PESO[b.prioridade] ||
      TIPO_PESO[a.tipo] - TIPO_PESO[b.tipo] ||
      a.epiNome.localeCompare(b.epiNome, "pt-BR"),
  );
}

/** Avalia todos os EPIs e devolve a lista única ordenada por prioridade. */
export function avaliarSinais(entradas: EntradaSinal[]): SinalOperacional[] {
  return ordenarSinais(entradas.flatMap(avaliarSinaisEpi));
}

/** Agrupa sinais por EPI (múltiplos sinais por EPI, sem duplicar dados). */
export function sinaisPorEpi(sinais: SinalOperacional[]): Map<string, SinalOperacional[]> {
  const map = new Map<string, SinalOperacional[]>();
  for (const s of ordenarSinais(sinais)) {
    const l = map.get(s.epiId);
    if (l) l.push(s);
    else map.set(s.epiId, [s]);
  }
  return map;
}

export { DIA_MS };
