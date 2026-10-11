/**
 * Camada de inteligência operacional (P3.1).
 *
 * Módulo puro: recebe dados por parâmetro, analisa em memória e devolve insights.
 * Não consulta o banco, não altera dados e não refaz fórmulas de estoque/compra
 * (cobertura e consumo diário vêm de calcularLinha, em estoque-calc.ts).
 * Insights descrevem dados observados; não afirmam desperdício ou irregularidade.
 */
import { DIA_MS } from "./estoque-calc";
import type { LinhaCalculada } from "./sinais-operacionais";

export type TipoInsight =
  | "CONSUMO_EM_ALTA"
  | "CONSUMO_EM_QUEDA"
  | "CONSUMO_ELEVADO_PERSISTENTE"
  | "ESTOQUE_DEPENDE_DE_PEDIDO"
  | "COBERTURA_EXCESSIVA"
  | "CONCENTRACAO_POR_TAMANHO"
  | "DADOS_INSUFICIENTES";

export type PrioridadeInsight = "ALTA" | "MEDIA" | "BAIXA" | "INFO";

export interface Periodo { inicio: string; fim: string }

export interface Insight {
  tipo: TipoInsight;
  prioridade: PrioridadeInsight;
  epiId: string | null;
  epiCodigo: string | null;
  epiNome: string;
  periodo: Periodo | null;
  observado: number | null;
  comparacao: number | null;
  variacaoPct: number | null;
  motivo: string;
  recomendacao: string;
  dadosInsuficientes: boolean;
  /** Para DADOS_INSUFICIENTES: qual análise não pôde ser feita. */
  analise?: "variacao" | "persistencia" | "tamanho";
}

export interface EntregaIn { epi_id: string; quantidade: number | null; data_movimentacao: string; tipo?: string }
export interface EpiIn {
  id: string; nome: string; codigo_produto?: string | null; tamanho?: string | null;
  estoque_atual: number;
}
export interface EntradaInteligencia {
  epis: EpiIn[];
  entregas: EntregaIn[];
  /** Linha já calculada por calcularLinha para cada EPI (por id). */
  linhas: Map<string, LinhaCalculada>;
  leadDias: number;
  ref?: Date;
}

export const LIMIAR_VARIACAO = 0.3;
export const MIN_REGISTROS_VARIACAO = 5;
export const MIN_REGISTROS_BASE = 5;
export const JANELAS_PERSISTENCIA = 3;
export const FATOR_COBERTURA_EXCESSIVA = 4;
export const MIN_ENTREGAS_TAMANHO = 10;
export const LIMIAR_CONCENTRACAO = 0.15;

const PESO: Record<PrioridadeInsight, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2, INFO: 3 };
const fmtN = (n: number) => (Math.round(n * 10) / 10).toLocaleString("pt-BR");
const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function inicioDoDia(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

/** Somente entregas válidas (quantidade > 0 e data válida). */
function validas(entregas: EntregaIn[]) {
  return entregas.flatMap((m) => {
    if (!m || (m.tipo && m.tipo !== "entrega")) return [];
    const t = new Date(m.data_movimentacao).getTime();
    const q = Number(m.quantidade);
    if (!m.epi_id || !Number.isFinite(t) || !Number.isFinite(q) || q <= 0) return [];
    return [{ epi: m.epi_id, t, q }];
  });
}

type Reg = { t: number; q: number };
function janela(regs: Reg[], de: number, ate: number) {
  let q = 0, n = 0;
  for (const r of regs) if (r.t >= de && r.t < ate) { q += r.q; n++; }
  return { q, n };
}

function base(e: EpiIn) {
  return { epiId: e.id, epiCodigo: e.codigo_produto ?? null, epiNome: e.nome };
}

/** Item-base: nome sem sufixo de tamanho, só quando o campo tamanho existe e o nome termina nele. */
export function itemBaseDoTamanho(e: EpiIn): string | null {
  const tam = (e.tamanho ?? "").trim();
  if (!tam) return null;
  const nome = e.nome.trim();
  if (!nome.toLowerCase().endsWith(" " + tam.toLowerCase())) return null;
  return nome.slice(0, nome.length - tam.length).trim().toLowerCase() || null;
}

export function analisarInteligencia(inp: EntradaInteligencia): Insight[] {
  const out: Insight[] = [];
  const hoje = inicioDoDia(inp.ref ?? new Date());
  const D = DIA_MS;
  const regsPorEpi = new Map<string, Reg[]>();
  for (const r of validas(inp.entregas ?? [])) {
    const l = regsPorEpi.get(r.epi) ?? [];
    l.push({ t: r.t, q: r.q });
    regsPorEpi.set(r.epi, l);
  }

  for (const e of inp.epis ?? []) {
    if (!e?.id) continue;
    const regs = regsPorEpi.get(e.id) ?? [];
    const b = base(e);

    // 1) Variação: últimos 30 dias completos vs. 30 anteriores (médias diárias).
    const atual = janela(regs, hoje - 30 * D, hoje);
    const ant = janela(regs, hoje - 60 * D, hoje - 30 * D);
    const periodo = { inicio: iso(hoje - 30 * D), fim: iso(hoje - D) };
    if (ant.q > 0 && atual.n + ant.n >= MIN_REGISTROS_VARIACAO) {
      const v = (atual.q / 30 - ant.q / 30) / (ant.q / 30);
      if (Math.abs(v) >= LIMIAR_VARIACAO) {
        const alta = v > 0;
        out.push({
          ...b, tipo: alta ? "CONSUMO_EM_ALTA" : "CONSUMO_EM_QUEDA", prioridade: alta ? "MEDIA" : "BAIXA",
          periodo, observado: atual.q, comparacao: ant.q, variacaoPct: v,
          motivo: `${atual.q} un. nos últimos 30 dias contra ${ant.q} un. nos 30 dias anteriores (${alta ? "+" : "−"}${pct(v)}).`,
          recomendacao: alta
            ? "Acompanhar as próximas entregas e verificar se há mudança de demanda."
            : "Acompanhar; a queda pode ser sazonal ou indicar entregas não registradas.",
          dadosInsuficientes: false,
        });
      }
    } else if (regs.length > 0) {
      out.push({
        ...b, tipo: "DADOS_INSUFICIENTES", prioridade: "INFO", analise: "variacao", periodo,
        observado: atual.q, comparacao: ant.q, variacaoPct: null,
        motivo: ant.q === 0
          ? "Sem entregas nos 30 dias anteriores para comparar."
          : `Apenas ${atual.n + ant.n} entregas em 60 dias (mínimo ${MIN_REGISTROS_VARIACAO}).`,
        recomendacao: "Aguardar mais histórico antes de avaliar variação.",
        dadosInsuficientes: true,
      });
    }

    // 2) Persistência: 3 janelas de 30 dias consecutivas acima da base (dias 91–365).
    const baseJ = janela(regs, hoje - 365 * D, hoje - 90 * D);
    if (baseJ.n >= MIN_REGISTROS_BASE && baseJ.q > 0) {
      const mediaBase = baseJ.q / 275;
      const janelas = Array.from({ length: JANELAS_PERSISTENCIA }, (_, i) =>
        janela(regs, hoje - (i + 1) * 30 * D, hoje - i * 30 * D).q / 30);
      if (janelas.every((d) => d >= mediaBase * (1 + LIMIAR_VARIACAO))) {
        const media = janelas.reduce((a, c) => a + c, 0) / janelas.length;
        const v = (media - mediaBase) / mediaBase;
        out.push({
          ...b, tipo: "CONSUMO_ELEVADO_PERSISTENTE", prioridade: "MEDIA",
          periodo: { inicio: iso(hoje - 90 * D), fim: iso(hoje - D) },
          observado: media, comparacao: mediaBase, variacaoPct: v,
          motivo: `Consumo acima do padrão nos últimos ${JANELAS_PERSISTENCIA} períodos de 30 dias: média de ${fmtN(media)} un./dia contra ${fmtN(mediaBase)} un./dia no histórico (+${pct(v)}).`,
          recomendacao: "Tendência, não pico isolado: considerar revisar a base de consumo usada no planejamento.",
          dadosInsuficientes: false,
        });
      }
    }

    // 3) Estoque x demanda (usa a linha já calculada; não recalcula compra).
    const linha = inp.linhas?.get(e.id);
    if (linha && linha.diario > 0 && e.estoque_atual > 0) {
      const coberturaSemPedido = e.estoque_atual / linha.diario;
      if (linha.transito > 0 && coberturaSemPedido < inp.leadDias && linha.cobertura >= inp.leadDias) {
        out.push({
          ...b, tipo: "ESTOQUE_DEPENDE_DE_PEDIDO", prioridade: "MEDIA", periodo: null,
          observado: Math.floor(coberturaSemPedido), comparacao: inp.leadDias, variacaoPct: null,
          motivo: `Sem o pedido em aberto (${linha.transito} un.) o estoque cobre ${Math.floor(coberturaSemPedido)} dias, menos que os ${inp.leadDias} dias até a reposição.`,
          recomendacao: "Acompanhar a chegada do pedido em aberto.",
          dadosInsuficientes: false,
        });
      } else if (Number.isFinite(linha.cobertura) && linha.cobertura > inp.leadDias * FATOR_COBERTURA_EXCESSIVA) {
        out.push({
          ...b, tipo: "COBERTURA_EXCESSIVA", prioridade: "BAIXA", periodo: null,
          observado: Math.floor(linha.cobertura), comparacao: inp.leadDias, variacaoPct: null,
          motivo: `Estoque cobre ${Math.floor(linha.cobertura)} dias de consumo, mais de ${FATOR_COBERTURA_EXCESSIVA}× o período sem reposição (${inp.leadDias} dias).`,
          recomendacao: "Avaliar se novas compras deste item podem ser adiadas.",
          dadosInsuficientes: false,
        });
      }
    }
  }

  // 4) Concentração por tamanho (entregas reais, 90 dias; só EPIs com campo tamanho confiável).
  const grupos = new Map<string, EpiIn[]>();
  for (const e of inp.epis ?? []) {
    if (!e?.id) continue;
    const ib = itemBaseDoTamanho(e);
    if (!ib) continue;
    const l = grupos.get(ib) ?? [];
    l.push(e);
    grupos.set(ib, l);
  }
  for (const [item, eps] of grupos) {
    if (eps.length < 2) continue;
    const dem = eps.map((e) => janela(regsPorEpi.get(e.id) ?? [], hoje - 90 * D, hoje).q);
    const totDem = dem.reduce((a, c) => a + c, 0);
    const totEst = eps.reduce((a, e) => a + Math.max(0, Number(e.estoque_atual) || 0), 0);
    const periodo = { inicio: iso(hoje - 90 * D), fim: iso(hoje - D) };
    if (totDem < MIN_ENTREGAS_TAMANHO) {
      out.push({
        epiId: null, epiCodigo: null, epiNome: item, tipo: "DADOS_INSUFICIENTES", prioridade: "INFO",
        analise: "tamanho", periodo, observado: totDem, comparacao: MIN_ENTREGAS_TAMANHO, variacaoPct: null,
        motivo: `Apenas ${totDem} un. entregues em 90 dias entre os tamanhos de "${item}".`,
        recomendacao: "Aguardar mais entregas para avaliar a distribuição por tamanho.",
        dadosInsuficientes: true,
      });
      continue;
    }
    eps.forEach((e, i) => {
      const shDem = dem[i] / totDem;
      const shEst = totEst > 0 ? Math.max(0, e.estoque_atual) / totEst : 0;
      if (shDem - shEst >= LIMIAR_CONCENTRACAO) {
        out.push({
          ...base(e), tipo: "CONCENTRACAO_POR_TAMANHO", prioridade: "MEDIA", periodo,
          observado: shDem, comparacao: shEst, variacaoPct: shDem - shEst,
          motivo: `Tamanho ${e.tamanho} recebeu ${pct(shDem)} das entregas de "${item}" em 90 dias, mas tem ${pct(shEst)} do estoque desse item.`,
          recomendacao: "Considerar a distribuição real por tamanho na próxima compra.",
          dadosInsuficientes: false,
        });
      }
    });
  }

  return out.sort((a, b) => PESO[a.prioridade] - PESO[b.prioridade] || a.epiNome.localeCompare(b.epiNome, "pt-BR"));
}
