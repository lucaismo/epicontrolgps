/**
 * Motor de cálculo compartilhado de estoque/consumo.
 *
 * Extraído de src/routes/_app/compras.tsx SEM alteração de fórmulas, para que
 * Compras, EPIs e Dashboard usem exatamente os mesmos números.
 */

export const DIA_MS = 86400000;

export function diaValidoDoMes(y: number, m: number, dia: number) {
  return new Date(y, m, Math.min(dia, new Date(y, m + 1, 0).getDate()));
}

/**
 * Tempo total sem reposição = dias até o próximo dia de pedido +
 * dias entre esse pedido e o próximo dia de recebimento.
 * Dinâmico em relação à data de hoje; se o dia do pedido já passou, usa o próximo ciclo.
 */
export function calcLeadTime(diaPedido: number, diaRecebimento: number, ref = new Date()) {
  const hoje = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let pedido = diaValidoDoMes(hoje.getFullYear(), hoje.getMonth(), diaPedido);
  if (pedido.getTime() < hoje.getTime()) {
    pedido = diaValidoDoMes(hoje.getFullYear(), hoje.getMonth() + 1, diaPedido);
  }
  let rm = pedido.getMonth();
  let receb = diaValidoDoMes(pedido.getFullYear(), rm, diaRecebimento);
  while (receb.getTime() <= pedido.getTime()) {
    rm += 1;
    receb = diaValidoDoMes(pedido.getFullYear(), rm, diaRecebimento);
  }
  const ateP = Math.round((pedido.getTime() - hoje.getTime()) / DIA_MS);
  const entrega = Math.round((receb.getTime() - pedido.getTime()) / DIA_MS);
  return { diasAtePedido: ateP, diasEntrega: entrega, dias: ateP + entrega, pedido, recebimento: receb };
}

export type ConsumoJanelas = { d30: number; d90: number; d365: number };

/** Agrega quantidades de entrega por EPI nas janelas de 30/90/365 dias. */
export function agregarConsumo(
  movs: { epi_id: string; quantidade: number | null; data_movimentacao: string }[],
  ref = Date.now(),
) {
  const map = new Map<string, ConsumoJanelas>();
  for (const m of movs) {
    const age = (ref - new Date(m.data_movimentacao).getTime()) / DIA_MS;
    const cur = map.get(m.epi_id) ?? { d30: 0, d90: 0, d365: 0 };
    const q = Number(m.quantidade ?? 0);
    if (age <= 30) cur.d30 += q;
    if (age <= 90) cur.d90 += q;
    cur.d365 += q;
    map.set(m.epi_id, cur);
  }
  return map;
}

export const CONSUMO_ZERO: ConsumoJanelas = { d30: 0, d90: 0, d365: 0 };

/** Consumo diário médio ponderado: prioriza 90d, depois 30d, depois 365d. */
export function consumoDiario(c: ConsumoJanelas) {
  return c.d90 > 0 ? c.d90 / 90 : c.d30 > 0 ? c.d30 / 30 : c.d365 / 365;
}

export type EpiCalc = {
  id: string;
  estoque_atual: number;
  estoque_minimo: number;
  dias_seguranca?: number | null;
};

export type Prioridade = "alta" | "media" | "baixa";

/** Linha de planejamento — mesma fórmula usada no módulo Compras. */
export function calcularLinha(epi: EpiCalc, c: ConsumoJanelas, transito: number, leadDias: number) {
  const diario = consumoDiario(c);
  const mensal = diario * 30;
  const disponivel = epi.estoque_atual + transito;
  const cobertura = diario > 0 ? disponivel / diario : Infinity;
  const diasSeg = Number(epi.dias_seguranca ?? 0);
  const estoqueSeg = diario * diasSeg;
  const sugerido = Math.max(0, Math.ceil(diario * leadDias + estoqueSeg - disponivel));
  let prioridade: Prioridade = "baixa";
  if (cobertura < leadDias) prioridade = "alta";
  else if (cobertura < leadDias + diasSeg || epi.estoque_atual < epi.estoque_minimo) prioridade = "media";
  const ruptura =
    diario > 0 && Number.isFinite(cobertura) ? new Date(Date.now() + cobertura * DIA_MS) : null;
  return { c, diario, mensal, transito, disponivel, cobertura, diasSeg, estoqueSeg, sugerido, prioridade, ruptura };
}

export type NivelEstoque = "zerado" | "critico" | "atencao" | "normal";

/** Semáforo padrão do sistema: vermelho = crítico/zerado, amarelo = atenção, verde = normal. */
export function nivelEstoque(atual: number, minimo: number): NivelEstoque {
  if (atual === 0) return "zerado";
  if (atual < minimo) return "critico";
  if (atual < minimo * 1.5) return "atencao";
  return "normal";
}

export const NIVEL_LABEL: Record<NivelEstoque, string> = {
  zerado: "Zerado",
  critico: "Crítico",
  atencao: "Atenção",
  normal: "Normal",
};

export const NIVEL_CLASS: Record<NivelEstoque, string> = {
  zerado: "bg-destructive/10 text-destructive border-destructive/30",
  critico: "bg-warning/15 text-warning border-warning/40",
  atencao: "bg-warning/10 text-warning border-warning/30",
  normal: "bg-success/15 text-success border-success/30",
};
