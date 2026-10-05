/**
 * Dados FICTÍCIOS do Ambiente de Revisão (/__review).
 * Nenhum registro aqui vem do banco real. Datas são relativas a "agora"
 * para que consumo, cobertura e ruptura tenham valores plausíveis.
 */
const DIA = 86_400_000;
const agora = Date.now();
const iso = (msAtras: number) => new Date(agora - msAtras).toISOString();

// Pseudoaleatório determinístico (mesmos dados a cada carregamento)
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

type EpiSeed = [nome: string, categoria: string, estoque: number, minimo: number, custo: number, consumoMes: number, tamanho?: string];
// consumoMes calibrado para gerar estados variados: normal, atenção, crítico, zerado, ruptura, compra
const EPI_SEEDS: EpiSeed[] = [
  ["Luva de Vaqueta", "Proteção das Mãos", 12, 40, 18.9, 45],          // crítico + ruptura
  ["Óculos de Segurança Incolor", "Proteção dos Olhos", 140, 30, 7.5, 20], // normal
  ["Protetor Auricular Plug", "Proteção Auditiva", 0, 50, 1.9, 60],    // zerado
  ["Capacete Aba Frontal", "Proteção da Cabeça", 38, 10, 32.0, 6],     // normal
  ["Botina 40", "Proteção dos Pés", 9, 8, 89.0, 5, "40"],              // atenção
  ["Botina 42", "Proteção dos Pés", 4, 8, 89.0, 6, "42"],              // crítico
  ["Mangote de Raspa", "Proteção dos Braços", 22, 15, 24.5, 9],        // ruptura próxima
  ["Camisa M", "Proteção do Tronco", 30, 20, 42.0, 14, "M"],           // atenção
  ["Camisa G", "Proteção do Tronco", 6, 25, 42.0, 22, "G"],            // crítico
  ["Calça 42", "Proteção dos Pés", 25, 10, 55.0, 5, "42"],             // normal
  ["Jugular para Capacete", "Proteção da Cabeça", 0, 10, 3.2, 4],      // zerado
  ["Touca Árabe", "Proteção da Cabeça", 60, 20, 9.9, 12],              // normal
  ["Respirador PFF2", "Proteção Respiratória", 15, 40, 4.8, 50],       // compra necessária
  ["Avental de Raspa", "Proteção do Tronco", 18, 5, 38.0, 0],          // sem consumo
];

export const epis = EPI_SEEDS.map(([nome, categoria, estoque, minimo, custo, , tamanho], i) => ({
  id: `epi-${i + 1}`,
  nome, categoria,
  codigo_produto: `REV-${String(1000 + i)}`,
  ca: String(30000 + i * 137),
  estoque_atual: estoque,
  estoque_minimo: minimo,
  custo_unitario: custo,
  dias_seguranca: 7,
  localizacao: "Almoxarifado Central",
  modelo: null as string | null,
  tamanho: tamanho ?? null,
  status: "ativo",
  created_at: iso(400 * DIA),
  updated_at: iso(2 * DIA),
}));

const NOMES = [
  "Ana Paula Ribeiro", "Bruno Carvalho Lima", "Carlos Eduardo Souza", "Daniela Martins", "Eduardo Nogueira",
  "Fernanda Alves Costa", "Gabriel Rocha", "Helena Duarte", "Igor Fernandes", "Juliana Prado",
  "Kleber Antunes", "Larissa Mota", "Marcos Vinícius Reis", "Natália Freitas", "Otávio Pereira",
  "Patrícia Gomes", "Rafael Teixeira", "Sabrina Lopes", "Thiago Barros", "Vanessa Moreira",
];
const FUNCOES = ["Operador de Produção", "Auxiliar de Logística", "Mecânico", "Eletricista", "Soldador", "Almoxarife"];
const TURNOS = ["Turno 1", "Turno 2", "Turno 3", "Administrativo"];

export const colaboradores = NOMES.map((nome, i) => ({
  id: `col-${i + 1}`,
  nome,
  matricula: String(100100 + i * 7),
  funcao: pick(FUNCOES),
  turno: TURNOS[i % 4],
  status: i === 19 ? "inativo" : "ativo",
  data_admissao: iso((200 + i * 30) * DIA).slice(0, 10),
  observacoes: null as string | null,
  created_at: iso(500 * DIA),
  updated_at: iso(10 * DIA),
}));

export const colaborador_tamanhos = colaboradores.slice(0, 12).flatMap((c, i) => [
  { id: `tam-${i}-1`, colaborador_id: c.id, item: "Camisa", tamanho: i % 2 ? "G" : "M", created_at: iso(DIA), updated_at: iso(DIA) },
  { id: `tam-${i}-2`, colaborador_id: c.id, item: "Calça", tamanho: "42", created_at: iso(DIA), updated_at: iso(DIA) },
  ...(i < 8 ? [{ id: `tam-${i}-3`, colaborador_id: c.id, item: "Bota", tamanho: i % 2 ? "42" : "40", created_at: iso(DIA), updated_at: iso(DIA) }] : []),
]);

const REVIEW_USER = "review-user";

// Movimentações: entregas distribuídas nos últimos 365 dias + entradas de estoque
const movs: any[] = [];
let mid = 0;
const ativos = colaboradores.filter((c) => c.status === "ativo");
EPI_SEEDS.forEach(([, , , , , consumoMes], ei) => {
  const epi = epis[ei];
  const total = Math.round(consumoMes * 12);
  for (let k = 0; k < total; ) {
    const qtd = rnd() < 0.8 ? 1 : 2;
    // mais peso nos últimos 90 dias
    const dias = rnd() < 0.4 ? rnd() * 90 : rnd() * 365;
    const col = pick(ativos);
    movs.push({
      id: `mov-${++mid}`, tipo: "entrega", quantidade: qtd, epi_id: epi.id, colaborador_id: col.id,
      data_movimentacao: iso(dias * DIA + Math.floor(rnd() * 8) * 3_600_000),
      motivo: pick(["Primeira entrega", "Troca por desgaste", "Troca por dano"]), observacao: null,
      usuario_responsavel: REVIEW_USER,
    });
    k += qtd;
  }
  for (let m = 1; m <= 5; m++) {
    movs.push({
      id: `mov-${++mid}`, tipo: "entrada_estoque", quantidade: Math.max(5, Math.round(consumoMes * 2)), epi_id: epi.id,
      colaborador_id: null, data_movimentacao: iso((m * 60 + ei) * DIA), motivo: "Recebimento de compra",
      observacao: null, usuario_responsavel: REVIEW_USER,
    });
  }
});
// algumas trocas/devoluções para histórico
for (let i = 0; i < 25; i++) {
  const epi = pick(epis); const col = pick(ativos);
  movs.push({
    id: `mov-${++mid}`, tipo: pick(["devolucao_normal", "devolucao_avaria", "descarte"]), quantidade: 1,
    epi_id: epi.id, colaborador_id: col.id, data_movimentacao: iso(rnd() * 200 * DIA),
    motivo: "Troca", observacao: null, usuario_responsavel: REVIEW_USER,
  });
}
const epiById = new Map(epis.map((e) => [e.id, e]));
const colById = new Map(colaboradores.map((c) => [c.id, c]));
export const movimentacoes = movs
  .sort((a, b) => a.data_movimentacao.localeCompare(b.data_movimentacao))
  .map((m) => ({ ...m, epis: epiById.get(m.epi_id) ?? null, colaboradores: m.colaborador_id ? colById.get(m.colaborador_id) ?? null : null }));

export const compras_config = [{ id: "cfg-1", singleton: true, dia_pedido: 20, dia_recebimento: 10, created_at: iso(DIA), updated_at: iso(DIA) }];

export const pedidos_compra = [
  { id: "ped-1", epi_id: "epi-1", quantidade: 60, status: "em_aberto", data_pedido: iso(25 * DIA), data_prevista: iso(4 * DIA).slice(0, 10), data_recebimento: null }, // atrasado
  { id: "ped-2", epi_id: "epi-13", quantidade: 100, status: "em_aberto", data_pedido: iso(5 * DIA), data_prevista: iso(-12 * DIA).slice(0, 10), data_recebimento: null },
  { id: "ped-3", epi_id: "epi-2", quantidade: 40, status: "recebido", data_pedido: iso(70 * DIA), data_prevista: iso(40 * DIA).slice(0, 10), data_recebimento: iso(41 * DIA) },
].map((p) => ({ ...p, observacao: null, usuario_responsavel: REVIEW_USER, created_at: p.data_pedido, updated_at: p.data_pedido, epis: epiById.get(p.epi_id) }));

export const compras_ajustes: any[] = [];

export const inventarios = [
  { id: "inv-1", local: null, descricao: "Contagem mensal", status: "em_andamento", data_inicio: iso(2 * DIA), data_fim: null, responsavel: REVIEW_USER },
  { id: "inv-2", local: "Almoxarifado Central", descricao: null, status: "finalizado", data_inicio: iso(35 * DIA), data_fim: iso(34 * DIA), responsavel: REVIEW_USER },
];

export const inventario_itens = inventarios.flatMap((inv) => epis.map((e, i) => {
  const contada = inv.status === "finalizado" || i % 3 === 0 ? e.estoque_atual + (i % 4 === 0 ? -1 : 0) : null;
  return {
    id: `${inv.id}-it-${i}`, inventario_id: inv.id, epi_id: e.id, quantidade_sistema: e.estoque_atual,
    quantidade_contada: contada, diferenca: contada === null ? null : contada - e.estoque_atual, epis: e,
  };
}));

export const profiles = [{ id: REVIEW_USER, nome: "Revisor (fictício)", email: "revisao@exemplo.invalid", created_at: iso(DIA) }];
export const user_roles = [{ id: "role-1", user_id: REVIEW_USER, role: "admin" }];
export const auditoria: any[] = [];

export const REVIEW_USER_ID = REVIEW_USER;

export const TABLES: Record<string, any[]> = {
  epis, colaboradores, colaborador_tamanhos, movimentacoes, compras_config, pedidos_compra,
  compras_ajustes, inventarios, inventario_itens, profiles, user_roles, auditoria,
};
