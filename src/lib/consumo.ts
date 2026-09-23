import { supabase } from "@/integrations/supabase/client";

/**
 * Tipos de movimentação que representam SAÍDA REAL (consumo) de EPI.
 * - "entrega": única que conta como consumo (é a que baixa o estoque).
 * - "troca"/"avariado"/"descarte"/"perda"/"roubo": destino do EPI anterior do colaborador
 *   (não baixam estoque novamente — contá-los duplicaria a troca).
 * - "entrada_estoque"/"ajuste_*": entradas e ajustes de inventário — nunca são consumo.
 */
export const TIPOS_CONSUMO = ["entrega"] as const;

export const TIPO_GRUPO: Record<string, "saida" | "devolucao" | "troca" | "entrada" | "ajuste"> = {
  entrega: "saida",
  devolucao_normal: "devolucao",
  troca: "troca", avariado: "troca", descarte: "troca", perda: "troca", roubo: "troca",
  entrada_estoque: "entrada",
  ajuste_entrada: "ajuste", ajuste_saida: "ajuste",
};

export const TIPO_LABEL: Record<string, string> = {
  entrega: "Entrega",
  devolucao_normal: "Devolução",
  troca: "Troca (EPI anterior)",
  avariado: "Avaria",
  descarte: "Descarte",
  perda: "Perda",
  roubo: "Roubo",
  entrada_estoque: "Entrada estoque",
  ajuste_entrada: "Ajuste (+)",
  ajuste_saida: "Ajuste (−)",
};

export type EntregaRow = { epi_id: string; quantidade: number | null; tipo: string; data_movimentacao: string };

const PAGE = 1000;

/**
 * Busca TODAS as entregas desde a data informada, paginando de 1000 em 1000.
 * O backend limita cada resposta a 1000 linhas; sem paginação o consumo era truncado.
 */
export async function fetchEntregasDesde(desdeIso: string): Promise<EntregaRow[]> {
  const out: EntregaRow[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await supabase.from("movimentacoes")
      .select("epi_id,quantidade,tipo,data_movimentacao")
      .eq("tipo", "entrega")
      .gte("data_movimentacao", desdeIso)
      .order("data_movimentacao", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as EntregaRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Itens sugeridos para cadastro de tamanho do colaborador. */
export const ITENS_TAMANHO = ["Camisa", "Calça", "Bota", "Luva", "Colete", "Capacete", "Jaqueta", "Macacão", "Óculos", "Protetor auricular"] as const;

export const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export type TamanhoColab = { id?: string; item: string; tamanho: string };

/** Retorna o tamanho cadastrado do colaborador que corresponde ao EPI (por nome ou categoria). */
export function tamanhoParaEpi(tams: TamanhoColab[], epi: { nome: string; categoria?: string | null }) {
  const n = norm(epi.nome), c = norm(epi.categoria);
  return tams.find((t) => { const i = norm(t.item); return i && (n.includes(i) || c === i); }) ?? null;
}

export const mesmoTamanho = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && norm(a) === norm(b);
