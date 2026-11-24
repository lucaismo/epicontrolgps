/**
 * Fábricas centralizadas de Query Keys (Etapa A).
 * Os valores PRESERVAM exatamente as chaves já usadas pelas telas, para que a
 * migração futura não invalide caches nem mude comportamento. Cada contrato de
 * dados distinto tem chave própria (lista completa ≠ filtrada ≠ detalhe ≠ página).
 */
export const queryKeys = {
  auth: {
    adminUsers: () => ["admin-users"] as const,
    perfilCompras: (userId: string | undefined) => ["compras-perfil", userId] as const,
    perfilRelatorios: (userId: string | undefined) => ["rel-perfil", userId] as const,
  },
  epis: {
    todos: () => ["epis"] as const,
    ativos: () => ["epis-ativos"] as const,
    compras: () => ["compras-epis"] as const,
    consumo: () => ["consumo-epis"] as const,
    relatorio: () => ["rel-epis"] as const,
    dashboardBase: () => ["dashboard-base"] as const,
  },
  colaboradores: {
    todos: () => ["colaboradores"] as const,
    ativos: () => ["colabs-ativos"] as const,
    detalhe: (id: string) => ["colab", id] as const,
    movimentacoes: (id: string) => ["colab-movs", id] as const,
    historicoTurno: (id: string) => ["colab-turno-hist", id] as const,
    relatorio: () => ["rel-colabs"] as const,
    planejamentoTamanho: () => ["plan-tam-colabs"] as const,
  },
  tamanhos: {
    doColaborador: (colaboradorId: string) => ["colab-tamanhos", colaboradorId] as const,
    todos: () => ["colaborador-tamanhos-all"] as const,
    planejamento: () => ["plan-tam-tamanhos"] as const,
  },
  compras: {
    config: () => ["compras-config"] as const,
    ajustes: (ano: number, mes: number) => ["compras-ajustes", ano, mes] as const,
  },
  pedidos: {
    todos: () => ["compras-pedidos"] as const,
  },
  movimentacoes: {
    entregas365: () => ["compras-movs"] as const,
    dashboardMes: (ano: number, mes: number) => ["dashboard-movs", ano, mes] as const,
    dashboardEvolucao: (ano: number, mes: number) => ["dashboard-evolucao", ano, mes] as const,
    consumoAno: (ano: number) => ["consumo-ano", ano] as const,
    relatorioMes: (ano: number, mes: number) => ["rel-movs", ano, mes] as const,
    ultimasEntregas: (page: number, termo: string) => ["ultimas-entregas", page, termo] as const,
  },
  inventarios: {
    todos: () => ["inventarios"] as const,
    resumo: () => ["inventarios-resumo"] as const,
    detalhe: (id: string) => ["inv", id] as const,
    itens: (id: string) => ["inv-itens", id] as const,
  },
} as const;

/** Padrões globais conservadores; políticas por domínio sobrescrevem na própria query. */
export const QUERY_DEFAULTS = {
  staleTime: 60_000,
  gcTime: 10 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  retry: 1,
} as const;

/**
 * Decide se o cache deve ser descartado numa transição de autenticação:
 * no logout, ou quando entra um usuário diferente do anterior (mesmo terminal).
 */
export function deveLimparCache(evento: string, uidAnterior: string | null, uidNovo: string | null): boolean {
  if (evento === "SIGNED_OUT") return true;
  if (evento === "SIGNED_IN" && uidAnterior !== null && uidNovo !== uidAnterior) return true;
  return false;
}
