import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Package, ArrowUpRight, ShoppingCart, TriangleAlert, CalendarDays, ArrowUpFromLine } from "lucide-react";
import { ResponsiveContainer, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Line, ComposedChart } from "recharts";
import { useEpiMetrics } from "@/hooks/use-epi-metrics";
import { DIA_MS } from "@/lib/estoque-calc";
import { fetchPaginado } from "@/lib/consumo";
import { integrarInteligencia } from "@/lib/inteligencia-integracao";
import { InteligenciaOperacional } from "@/components/InteligenciaOperacional";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutDashboard } from "lucide-react";
import { avaliarSinais, sinaisPorEpi, PRIORIDADE_PESO, type PrioridadeSinal, type AcaoSinal, type SinalOperacional } from "@/lib/sinais-operacionais";

const ACAO_DESTINO: Record<AcaoSinal, "/compras" | "/consumo" | "/epis"> = {
  Comprar: "/compras", "Ver compra": "/compras", "Ver consumo": "/consumo", "Ver EPI": "/epis",
};
const PRIO_LABEL: Record<PrioridadeSinal, string> = { CRITICA: "Crítica", ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" };
const PRIO_STATUS: Record<PrioridadeSinal, string> = { CRITICA: "status-critical", ALTA: "status-critical", MEDIA: "status-warning", BAIXA: "status-nodata" };
const PRIO_DOT: Record<PrioridadeSinal, string> = { CRITICA: "bg-destructive", ALTA: "bg-destructive/60", MEDIA: "bg-warning", BAIXA: "bg-muted-foreground/50" };
const PRIO_TEXT: Record<PrioridadeSinal, string> = { CRITICA: "text-destructive", ALTA: "text-destructive", MEDIA: "text-warning-ink", BAIXA: "text-muted-foreground" };
export type { SinalOperacional };

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [
    { title: "Central de Controle | EPI Guard" },
    { name: "description", content: "Indicadores operacionais de estoque, reposição e entregas do EPI Guard." },
    { property: "og:title", content: "Central de Controle | EPI Guard" },
    { property: "og:description", content: "Acompanhe estoque, prioridades de reposição e movimentações de EPIs." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Dashboard,
});

type EpiRow = {
  id: string; nome: string; estoque_atual: number; estoque_minimo: number;
  custo_unitario: number | null; categoria: string | null; codigo_produto?: string | null;
  dias_seguranca?: number | null; tamanho?: string | null;
};

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MESES_CURTO = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const ENTRADA_TIPOS = new Set(["entrada_estoque", "ajuste_entrada", "devolucao_normal"]);
const SAIDA_TIPOS = new Set(["entrega", "ajuste_saida"]);
const COR_ENTRADA = "var(--success-ink)";
const COR_SAIDA = "var(--primary)";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function Dashboard() {
  const now = new Date();
  const [mes, setMes] = useState<number>(now.getMonth());
  const [ano, setAno] = useState<number>(now.getFullYear());
  const { metricaDe, lead, pedidos, entregas365, erroMovs, carregandoMovs, carregandoConfigInicial: carregandoConfig, erroConfig, carregandoPedidosInicial: carregandoPedidos, erroPedidos } = useEpiMetrics(true);

  const periodo = useMemo(() => ({
    inicio: new Date(ano, mes, 1, 0, 0, 0).toISOString(),
    fim: new Date(ano, mes + 1, 1, 0, 0, 0).toISOString(),
  }), [ano, mes]);

  // Cadastros (independentes do período)
  const { data: base, isLoading: carregandoBase, isError: erroBase } = useQuery({
    queryKey: ["dashboard-base"],
    queryFn: async () => {
      const [episRes, colabRes, invRes] = await Promise.all([
        supabase.from("epis").select("id,nome,codigo_produto,estoque_atual,estoque_minimo,custo_unitario,categoria,dias_seguranca,tamanho").eq("status", "ativo"),
        supabase.from("colaboradores").select("id", { count: "exact", head: true }).eq("status", "ativo"),
        supabase.from("inventarios").select("id,local,data_inicio").eq("status", "em_andamento"),
      ]);
      if (episRes.error) throw episRes.error;
      if (colabRes.error) throw colabRes.error;
      if (invRes.error) throw invRes.error;
      return {
        epis: (episRes.data ?? []) as EpiRow[],
        colaboradores: colabRes.count ?? 0,
        inventariosPendentes: invRes.data ?? [],
      };
    },
  });

  // Movimentações do período selecionado (paginado em lotes de 1.000)
  const { data: movs = [], isLoading: carregandoPeriodo, isError: erroPeriodo } = useQuery({
    queryKey: ["dashboard-movs", ano, mes],
    queryFn: () => fetchPaginado<any>((from, to) => supabase
      .from("movimentacoes")
      .select("tipo,quantidade,epi_id,colaborador_id,data_movimentacao,epis(nome,categoria,custo_unitario),colaboradores(nome,matricula,turno)")
      .gte("data_movimentacao", periodo.inicio)
      .lt("data_movimentacao", periodo.fim)
      .order("data_movimentacao", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)),
  });

  // Evolução: últimos 6 meses até o período selecionado (+ movimentações posteriores
  // até hoje, para reconstruir o saldo histórico a partir do estoque atual)
  const { data: evolucaoRaw, isLoading: carregandoEvolucao, isError: erroEvolucao } = useQuery({
    queryKey: ["dashboard-evolucao", ano, mes],
    queryFn: async () => {
      const inicio6 = new Date(ano, mes - 5, 1, 0, 0, 0);
      const data = await fetchPaginado<any>((from, to) => supabase
        .from("movimentacoes")
        .select("tipo,quantidade,data_movimentacao")
        .gte("data_movimentacao", inicio6.toISOString())
        .order("data_movimentacao", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to));
      const buckets: { key: string; label: string; entradas: number; saidas: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(ano, mes - i, 1);
        buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MESES_CURTO[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, entradas: 0, saidas: 0 });
      }
      const idx = new Map(buckets.map((b, i) => [b.key, i]));
      let liquidoPosterior = 0; // entradas − saídas ocorridas após o fim do período
      const fimMs = new Date(periodo.fim).getTime();
      for (const m of (data ?? []) as any[]) {
        const d = new Date(m.data_movimentacao);
        const q = Number(m.quantidade ?? 0);
        if (d.getTime() >= fimMs) {
          if (ENTRADA_TIPOS.has(m.tipo)) liquidoPosterior += q;
          else if (SAIDA_TIPOS.has(m.tipo)) liquidoPosterior -= q;
          continue;
        }
        const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
        if (i === undefined) continue;
        if (ENTRADA_TIPOS.has(m.tipo)) buckets[i].entradas += q;
        else if (SAIDA_TIPOS.has(m.tipo)) buckets[i].saidas += q;
      }
      return { buckets, liquidoPosterior };
    },
  });

  // isLoading identifica a consulta inicial; refetch mantém os dados em cache visíveis, inclusive [].
  const carregandoMetricas = carregandoBase || carregandoMovs || carregandoConfig || carregandoPedidos;
  const erroMetricas = erroBase || erroMovs || erroConfig || erroPedidos;
  const epis = base?.epis ?? [];

  const estoque = useMemo(() => {
    // Mesma origem de EPIs/Compras: nível e mínimo efetivo vêm do motor (calcularLinha).
    // `estoque_minimo` abaixo passa a representar o mínimo EFETIVO (exibição nas listas).
    const efetivos = epis.map((e) => {
      const m = metricaDe(e);
      return { ...e, estoque_minimo: m.minimoEfetivo, nivel: m.nivel };
    });
    const zerados = efetivos.filter((e) => e.nivel === "zerado");
    const criticos = efetivos.filter((e) => e.nivel === "critico");
    const abaixoMin = efetivos.filter((e) => e.estoque_atual < e.estoque_minimo);
    const valorTotal = epis.reduce((s, e) => s + e.estoque_atual * Number(e.custo_unitario ?? 0), 0);
    const estoqueTotal = epis.reduce((s, e) => s + (e.estoque_atual ?? 0), 0);
    // Ruptura prevista dentro do ciclo de reposição (mesma métrica do módulo Compras)
    const ruptura = epis
      .map((e) => ({ epi: e, m: metricaDe(e) }))
      .filter(({ epi, m }) => m.ruptura !== null && epi.estoque_atual > 0 && m.cobertura < lead.dias)
      .sort((a, b) => a.m.cobertura - b.m.cobertura);
    return { zerados, criticos, abaixoMin, valorTotal, estoqueTotal, ruptura };
  }, [epis, metricaDe, lead.dias]);

  // Pedidos de compra em aberto / atrasados (mesma fonte do módulo Compras)
  const pedidosInfo = useMemo(() => {
    const nomes = new Map(epis.map((e) => [e.id, e.nome]));
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const abertos = (pedidos as any[]).filter((p) => p.status === "em_aberto");
    const atrasados = abertos
      .filter((p) => p.data_prevista && new Date(p.data_prevista).getTime() < hoje.getTime())
      .sort((a, b) => new Date(a.data_prevista).getTime() - new Date(b.data_prevista).getTime())
      .map((p) => ({
        id: p.id as string, nome: nomes.get(p.epi_id) ?? "EPI", qtd: Number(p.quantidade ?? 0),
        diasAtraso: Math.floor((hoje.getTime() - new Date(p.data_prevista).getTime()) / DIA_MS),
      }));
    const sortedAbertos = [...abertos]
      .sort((a, b) => new Date(a.data_prevista ?? "2100-01-01").getTime() - new Date(b.data_prevista ?? "2100-01-01").getTime())
      .map((p) => ({
        id: p.id as string, nome: nomes.get(p.epi_id) ?? "EPI", qtd: Number(p.quantidade ?? 0),
        prevista: p.data_prevista ? fmtData(new Date(p.data_prevista)) : "sem previsão",
      }));
    return { abertos: sortedAbertos, atrasados };
  }, [pedidos, epis]);

  // Evolução do estoque: reconstrói o saldo ao fim de cada mês a partir do estoque atual
  const evolucao = useMemo(() => {
    const buckets = evolucaoRaw?.buckets ?? [];
    let saldo = estoque.estoqueTotal - (evolucaoRaw?.liquidoPosterior ?? 0);
    const out: (typeof buckets[number] & { saldo: number })[] = [];
    for (let i = buckets.length - 1; i >= 0; i--) {
      out[i] = { ...buckets[i], saldo: Math.max(0, saldo) };
      saldo -= buckets[i].entradas - buckets[i].saidas;
    }
    return out;
  }, [evolucaoRaw, estoque.estoqueTotal]);


  const periodoStats = useMemo(() => {
    const entregas = movs.filter((m) => m.tipo === "entrega");
    const totalEntregas = entregas.reduce((s, m) => s + m.quantidade, 0);
    const custo = entregas.reduce((s, m) => s + m.quantidade * Number(m.epis?.custo_unitario ?? 0), 0);

    const porCat = new Map<string, number>();
    entregas.forEach((m) => {
      const c = m.epis?.categoria ?? "Sem categoria";
      porCat.set(c, (porCat.get(c) ?? 0) + m.quantidade);
    });
    const consumoCategoria = [...porCat.entries()].map(([categoria, qtd]) => ({ categoria, qtd })).sort((a, b) => b.qtd - a.qtd);

    const porEpi = new Map<string, { nome: string; entradas: number; saidas: number }>();
    movs.forEach((m) => {
      const nome = m.epis?.nome ?? "?";
      const cur = porEpi.get(nome) ?? { nome, entradas: 0, saidas: 0 };
      if (ENTRADA_TIPOS.has(m.tipo)) cur.entradas += m.quantidade;
      else if (SAIDA_TIPOS.has(m.tipo)) cur.saidas += m.quantidade;
      porEpi.set(nome, cur);
    });
    const movPorEpi = [...porEpi.values()].sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas)).slice(0, 10);

    const porColab = new Map<string, { nome: string; matricula: string; turno: string; entregas: number; itens: number; devolucoes: number; epis: Set<string> }>();
    movs.filter((m) => m.colaborador_id).forEach((m) => {
      const cur = porColab.get(m.colaborador_id) ?? {
        nome: m.colaboradores?.nome ?? "—", matricula: m.colaboradores?.matricula ?? "", turno: m.colaboradores?.turno ?? "—",
        entregas: 0, itens: 0, devolucoes: 0, epis: new Set<string>(),
      };
      if (m.tipo === "entrega") { cur.entregas += 1; cur.itens += m.quantidade; if (m.epis?.nome) cur.epis.add(m.epis.nome); }
      else cur.devolucoes += 1;
      porColab.set(m.colaborador_id, cur);
    });
    const relColab = [...porColab.values()].map((r) => ({ ...r, episTxt: [...r.epis].join(", ") })).sort((a, b) => b.itens - a.itens);

    return { totalEntregas, custo, totalMovs: movs.length, consumoCategoria, movPorEpi, relColab };
  }, [movs]);

  const anos = useMemo(() => { const y = now.getFullYear(); return [y - 2, y - 1, y, y + 1]; }, [now]);
  const periodoLabel = `${MESES[mes]}/${ano}`;
  const inventariosPendentes = base?.inventariosPendentes ?? [];

  // Compras necessárias: EPIs com compra sugerida > 0 (mesma fórmula de Compras)
  const compras = useMemo(() => {
    const itens = epis.map((e) => ({ e, m: metricaDe(e) })).filter(({ m }) => m.sugerido > 0);
    return { qtdEpis: itens.length, unidades: itens.reduce((s, { m }) => s + m.sugerido, 0), alta: itens.filter(({ m }) => m.prioridade === "alta").length };
  }, [epis, metricaDe]);

  // Distribuição por nível (mesmo nivel do motor)
  const saude = useMemo(() => {
    const cont = { normal: 0, atencao: 0, critico: 0, zerado: 0 } as Record<"normal" | "atencao" | "critico" | "zerado", number>;
    for (const e of epis) cont[metricaDe(e).nivel] += 1;
    return cont;
  }, [epis, metricaDe]);

  // Fila de prioridades: sinais do motor (sinais-operacionais.ts), agrupados por EPI
  const prioridades = useMemo(() => {
    const sinaisMotor = avaliarSinais(epis.map((e) => ({ epi: e, linha: metricaDe(e), leadDias: lead.dias })));
    return [...sinaisPorEpi(sinaisMotor).values()].map((lista) => {
      const e = epis.find((x) => x.id === lista[0].epiId)!;
      const m = metricaDe(e);
      return {
        id: e.id, nome: e.nome, sub: e.categoria ?? "", sinais: lista,
        atual: e.estoque_atual, minimo: m.minimoEfetivo,
        cobertura: Number.isFinite(m.cobertura) ? Math.floor(m.cobertura) : null,
      };
    }).sort((a, b) => PRIORIDADE_PESO[a.sinais[0].prioridade] - PRIORIDADE_PESO[b.sinais[0].prioridade]);
  }, [epis, metricaDe, lead.dias]);

  // Inteligência operacional: reaproveita entregas365 (cache de Compras) e linhas do motor único
  const inteligencia = useMemo(() => {
    if (erroMetricas) return { ok: false, erro: "falha ao carregar entregas", acionaveis: [], insuficientes: [], total: 0 };
    if (carregandoMetricas || !base) return null;
    return integrarInteligencia({
      epis, entregas: entregas365 as any[], leadDias: lead.dias,
      linhas: new Map(epis.map((e) => [e.id, metricaDe(e)])),
    });
  }, [epis, entregas365, carregandoMetricas, erroMetricas, base, metricaDe, lead.dias]);

  const entregasRecentes = useMemo(
    () => movs.filter((m) => m.tipo === "entrega").slice(-8).reverse(),
    [movs],
  );

  const sinais: { label: string; count: number; sev: Sev; to: LinkTo; search?: Record<string, string>; loading: boolean; error: boolean }[] = [
    { label: "Ruptura próxima", count: estoque.ruptura.length, sev: "critical", to: "/compras", search: { prioridade: "alta" }, loading: carregandoMetricas, error: erroMetricas },
    { label: "Estoque zerado", count: estoque.zerados.length, sev: "critical", to: "/epis", search: { nivel: "zerado" }, loading: carregandoMetricas, error: erroMetricas },
    { label: "Estoque crítico", count: estoque.criticos.length, sev: "critical", to: "/epis", search: { nivel: "critico" }, loading: carregandoMetricas, error: erroMetricas },
    { label: "Pedido atrasado", count: pedidosInfo.atrasados.length, sev: "critical", to: "/compras", loading: carregandoBase || carregandoPedidos, error: erroBase || erroPedidos },
    { label: "Pedidos em aberto", count: pedidosInfo.abertos.length, sev: "neutral", to: "/compras", loading: carregandoBase || carregandoPedidos, error: erroBase || erroPedidos },
    { label: "Inventário em andamento", count: inventariosPendentes.length, sev: "neutral", to: "/inventario", loading: carregandoBase, error: erroBase },
  ];

  const totalNiveis = epis.length || 1;
  const maxCat = Math.max(1, ...periodoStats.consumoCategoria.map((c) => c.qtd));

  return (
    <div className="dashboard-view mx-auto w-full max-w-[1920px] px-4 py-6 md:px-8 xl:px-10 space-y-8">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground"><LayoutDashboard className="h-4 w-4" /> EPI Guard / Operação</div>
          <h1 className="text-3xl font-semibold leading-tight">Central de Controle</h1>
          {erroBase ? (
            <p className="mt-2 text-sm text-destructive" role="alert">Não foi possível carregar os totais cadastrais.</p>
          ) : carregandoBase ? (
            <Skeleton className="mt-3 h-4 w-56" aria-label="Carregando totais" />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{epis.length} EPIs ativos <span className="mx-2">·</span> {base?.colaboradores ?? 0} colaboradores</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="w-36 h-10 bg-card" aria-label="Mês de referência"><SelectValue /></SelectTrigger>
            <SelectContent>{MESES.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-24 h-10 bg-card" aria-label="Ano de referência"><SelectValue /></SelectTrigger>
            <SelectContent>{anos.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </header>

      {/* Faixa de indicadores */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 border-y bg-card divide-y sm:divide-y-0">
        <Stat icon={Package} label="Estoque total" value={estoque.estoqueTotal.toLocaleString("pt-BR")} unit="un" hint={`Valor ${brl(estoque.valorTotal)}`} loading={carregandoBase} error={erroBase} />
        <Stat icon={ArrowUpFromLine} label="Entregas no período" value={periodoStats.totalEntregas.toLocaleString("pt-BR")} unit="un" hint={`${periodoLabel} · ${brl(periodoStats.custo)}`} loading={carregandoPeriodo} error={erroPeriodo} />
        <Stat icon={TriangleAlert} label="EPIs críticos" value={String(estoque.criticos.length)} unit="EPIs" sev={estoque.criticos.length ? "critical" : undefined}
          hint={`+ ${estoque.zerados.length} zerados`} loading={carregandoMetricas} error={erroMetricas} to="/epis" search={{ nivel: "critico" }} />
        <Stat icon={ShoppingCart} label="Compras necessárias" value={String(compras.qtdEpis)} unit="EPIs" sev={compras.alta ? "critical" : undefined}
          hint={`${compras.unidades.toLocaleString("pt-BR")} un sugeridas · ${compras.alta} alta prioridade`} loading={carregandoMetricas} error={erroMetricas} to="/compras" />
      </section>

      {/* Saúde do estoque */}
      <section className="border-b pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="type-section">Saúde do estoque</h2>
          <span className="type-aux">{erroMetricas ? "Indisponível" : carregandoMetricas ? "Carregando…" : `${estoque.abaixoMin.length} EPIs abaixo do mínimo`}</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-sm bg-muted">
          {!carregandoMetricas && !erroMetricas && NIVEIS.map((n) => saude[n.key] > 0 && (
            <div key={n.key} className={n.bar} style={{ width: `${(saude[n.key] / totalNiveis) * 100}%` }} title={`${n.label}: ${saude[n.key]}`} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {NIVEIS.map((n) => (
            <Link key={n.key} to="/epis" search={{ nivel: n.key } as any} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40">
              <span className={`h-2.5 w-2.5 rounded-sm ${n.bar}`} />
              <span className="text-sm">{n.label}</span>
              <span className="num text-lg font-semibold ml-auto sm:ml-1">{erroMetricas ? "—" : carregandoMetricas ? <Skeleton className="h-5 w-8" /> : saude[n.key]}</span>
              <span className="type-aux num">{!erroMetricas && !carregandoMetricas ? `${Math.round((saude[n.key] / totalNiveis) * 100)}%` : ""}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Prioridades + Sinais */}
      <section className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 pb-4 border-b">
            <div className="flex items-center gap-2">
              <h2 className="type-section">Prioridades</h2>
              <span className="type-label num rounded bg-muted px-1.5 py-0.5">{erroMetricas ? "—" : carregandoMetricas ? <Skeleton className="h-4 w-6" /> : prioridades.length}</span>
            </div>
            <span className="type-aux hidden sm:block">{erroConfig ? "Ciclo indisponível" : carregandoConfig ? "Carregando…" : `Ciclo de reposição · ${lead.dias} dias`}</span>
          </div>
          {erroMetricas ? <FalhaIndicador /> : carregandoMetricas ? <Skeleton className="my-6 h-20 w-full" aria-label="Carregando prioridades" /> : prioridades.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Nenhum item exige ação. Estoque dentro dos parâmetros.
            </div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_80px_80px_110px] gap-3 px-4 py-2 type-label border-b bg-muted/40">
                <span>EPI</span><span>Sinal</span><span className="text-right">Atual / mín.</span><span className="text-right">Cobertura</span><span />
              </div>
              <ul className="divide-y">
                {prioridades.slice(0, 10).map((p) => {
                  const [s, ...outros] = p.sinais;
                  const dest = ACAO_DESTINO[s.acao];
                  return (
                    <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_80px_80px_110px] gap-x-3 gap-y-1 items-start md:items-center px-4 py-4 hover:bg-muted/40">
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${PRIO_DOT[s.prioridade]}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold break-words">{p.nome}</div>
                          <div className="type-aux truncate">{p.sub}</div>
                        </div>
                      </div>
                      <div className="min-w-0 order-3 md:order-none col-span-2 md:col-span-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`status-pill ${PRIO_STATUS[s.prioridade]}`}>{PRIO_LABEL[s.prioridade]}</span>
                          <span className={`text-sm font-medium ${PRIO_TEXT[s.prioridade]}`}>{s.mensagem}</span>
                        </div>
                        {s.detalhe && <div className="type-aux">{s.detalhe}</div>}
                        {outros.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {outros.map((o) => (
                              <span key={o.tipo} className={`status-pill ${PRIO_STATUS[o.prioridade]}`} title={o.detalhe ?? undefined}>{o.mensagem}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="hidden md:block text-right text-sm num">{p.atual}<span className="text-muted-foreground"> / {p.minimo}</span></div>
                      <div className="hidden md:block text-right text-sm num">{p.cobertura === null ? "—" : `${p.cobertura} d`}</div>
                      <div className="text-right">
                        <Button asChild variant="ghost" size="sm" className="text-primary">
                          <Link to={dest}>{s.acao} <ArrowUpRight className="h-3.5 w-3.5" /></Link>
                        </Button>
                      </div>
                      <div className="md:hidden type-aux num order-4 col-span-2">
                        Estoque {p.atual}/{p.minimo}{p.cobertura !== null && ` · ${p.cobertura} d de cobertura`}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {prioridades.length > 10 && (
                <Link to="/compras" className="block px-4 py-2.5 border-t text-xs font-medium text-primary hover:bg-muted/40">
                  Ver mais {prioridades.length - 10} itens em Compras
                </Link>
              )}
            </>
          )}
        </div>

        <aside className="h-fit xl:border-l xl:pl-6">
          <div className="pb-4 border-b"><h2 className="type-section">Sinais operacionais</h2></div>
          <ul className="divide-y">
            {sinais.map((s) => (
              <li key={s.label}>
                <Link to={s.to} search={s.search as any} className="flex items-center justify-between gap-3 px-4 py-4 hover:bg-muted/40">
                  <span className="flex items-center gap-2.5 text-sm">
                    <span className={`h-2 w-2 rounded-full ${s.count ? SEV_DOT[s.sev] : "bg-muted-foreground/30"}`} />
                    <span className={s.count ? "" : "text-muted-foreground"}>{s.label}</span>
                  </span>
                  <span className={`num text-lg font-semibold ${s.count ? SEV_TEXT[s.sev] : "text-muted-foreground"}`}>{s.error ? "Indisponível" : s.loading ? <Skeleton className="h-5 w-8" aria-label={`Carregando ${s.label}`} /> : s.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <InteligenciaOperacional resultado={inteligencia} carregando={!erroMetricas && (carregandoMetricas || !base)} />

      {/* Consumo + Entregas recentes */}
      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] border-t pt-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b">
            <h2 className="type-section">Entradas e saídas</h2>
            <span className="type-aux">6 meses até {periodoLabel} · unidades</span>
          </div>
          <div className="flex items-center gap-5 pt-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><span className="h-2 w-4 rounded-sm bg-primary" /> Saídas</span>
            <span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-success-ink" /> Entradas</span>
          </div>
          <div className="pt-4">
            {erroEvolucao || erroBase ? <FalhaIndicador /> : carregandoEvolucao || carregandoBase ? <Skeleton className="h-[260px] w-full" aria-label="Carregando evolução" /> : evolucao.some((b) => b.entradas || b.saidas) ? (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={evolucao} margin={{ left: 0, right: 12, top: 12, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} allowDecimals={false} tickLine={false} axisLine={false} width={48} />
                  <Tooltip content={<MovementTooltip />} cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} />
                  <Bar dataKey="saidas" name="Saídas" fill={COR_SAIDA} radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false} />
                  <Line type="monotone" dataKey="entradas" name="Entradas" stroke={COR_ENTRADA} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <Vazio />}
          </div>
          <div className="pb-4 pt-4 border-t">
            <div className="type-label mb-2">Entregas por categoria · {periodoLabel}</div>
            {erroPeriodo ? <FalhaIndicador /> : carregandoPeriodo ? <Skeleton className="h-20 w-full" aria-label="Carregando categorias" /> : periodoStats.consumoCategoria.length ? (
              <ul className="space-y-3">
                {periodoStats.consumoCategoria.slice(0, 6).map((c) => (
                  <li key={c.categoria} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_56px] items-center gap-3 text-sm">
                    <span className="break-words">{c.categoria}</span>
                    <span className="h-1.5 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-primary" style={{ width: `${(c.qtd / maxCat) * 100}%` }} /></span>
                    <span className="num text-right">{c.qtd}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="type-aux">Sem entregas no período.</p>}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b">
            <h2 className="type-section">Entregas recentes</h2>
            <Button asChild variant="ghost" size="sm" className="text-primary"><Link to="/entregas">Nova entrega <ArrowUpRight /></Link></Button>
          </div>
          {erroPeriodo ? <FalhaIndicador /> : carregandoPeriodo ? <Skeleton className="my-4 h-20 w-full" aria-label="Carregando entregas recentes" /> : entregasRecentes.length ? (
            <ul className="divide-y">
              {entregasRecentes.map((m: any, i: number) => (
                <li key={i} className="grid grid-cols-[76px_minmax(0,1fr)_auto] gap-3 items-center py-4">
                  <span className="num type-aux">{fmtHora(m.data_movimentacao)}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium break-words">{m.colaboradores?.nome ?? "—"}</div>
                    <div className="type-aux mt-1 break-words">{m.epis?.nome ?? "—"} · {m.colaboradores?.turno ?? "—"}</div>
                  </div>
                  <span className="num text-sm font-semibold">{m.quantidade}<span className="type-aux font-normal"> un</span></span>
                </li>
              ))}
            </ul>
          ) : <Vazio />}
        </div>
      </section>
    </div>
  );
}

function FalhaIndicador() {
  return <p role="alert" className="py-10 text-sm text-destructive">Falha ao consultar os indicadores.</p>;
}

function Vazio() {
  return <p className="text-sm text-muted-foreground py-10 text-center">Sem movimentações no período selecionado.</p>;
}

type Sev = "critical" | "warning" | "neutral";
const SEV_DOT: Record<Sev, string> = { critical: "bg-destructive", warning: "bg-warning", neutral: "bg-muted-foreground/50" };
const SEV_TEXT: Record<Sev, string> = { critical: "text-destructive", warning: "text-warning-ink", neutral: "text-muted-foreground" };
type LinkTo = "/epis" | "/compras" | "/inventario";
type PrioItem = {
  id: string; nome: string; sub: string; motivo: string; sev: Sev;
  atual: number | null; minimo: number | null; cobertura: number | null; ruptura: string | null;
  acao: "comprar" | "ver" | "pedido";
};
const NIVEIS = [
  { key: "normal", label: "Normal", bar: "bg-success" },
  { key: "atencao", label: "Atenção", bar: "bg-warning/60" },
  { key: "critico", label: "Crítico", bar: "bg-destructive/60" },
  { key: "zerado", label: "Zerado", bar: "bg-destructive" },
] as const;

const fmtHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

function MovementTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name?: string; value?: number | string; dataKey?: string | number }[]; label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return <div className="min-w-40 rounded-md border bg-popover p-3 text-popover-foreground shadow-sm">
    <div className="mb-2 text-xs font-semibold">{label}</div>
    {payload.map((entry) => <div key={entry.dataKey} className="flex items-center justify-between gap-5 py-1 text-sm">
      <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-sm ${entry.dataKey === "saidas" ? "bg-primary" : "bg-success-ink"}`} />{entry.name}</span>
      <span className="num font-semibold">{Number(entry.value ?? 0).toLocaleString("pt-BR")} un</span>
    </div>)}
  </div>;
}

function Stat({ icon: Icon, label, value, unit, hint, sev, to, search, loading, error }: {
  icon: typeof Package; label: string; value: string; unit: string; hint: string; sev?: Sev; loading?: boolean; error?: boolean; to?: "/epis" | "/compras"; search?: Record<string, string>;
}) {
  const inner = (
    <div className="px-5 py-6 h-full sm:border-l sm:border-border">
      <div className="flex items-center justify-between gap-3 text-sm font-medium text-muted-foreground">
        <span>{label}</span><Icon className={`h-4 w-4 shrink-0 ${sev ? SEV_TEXT[sev] : "text-muted-foreground"}`} />
      </div>
      {error ? (
        <div role="alert">
          <div className="my-3 flex items-baseline gap-2"><span className="text-2xl leading-[2.75rem] font-semibold text-destructive">Indisponível</span></div>
          <div className="text-xs leading-5 text-destructive">Falha ao consultar este indicador.</div>
        </div>
      ) : loading ? (
        <div aria-busy="true" aria-label={`Carregando ${label}`}>
          <div className="my-3 flex h-11 items-center"><Skeleton className="h-9 w-28" /></div>
          <div className="flex h-5 items-center"><Skeleton className="h-3 w-40" /></div>
        </div>
      ) : (<>
      <div className="my-3 flex flex-wrap items-baseline gap-2">
        <span className={`text-4xl leading-tight font-semibold num break-all ${sev ? SEV_TEXT[sev] : ""}`}>{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <div className="text-xs leading-5 text-muted-foreground">{hint}</div>
      </>)}
    </div>
  );
  return to ? <Link to={to} search={search as any} className="block hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{inner}</Link> : inner;
}
