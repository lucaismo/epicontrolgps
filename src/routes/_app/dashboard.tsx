import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, CheckCircle2 } from "lucide-react";
import { ResponsiveContainer, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Line, ComposedChart } from "recharts";
import { useEpiMetrics } from "@/hooks/use-epi-metrics";
import { DIA_MS } from "@/lib/estoque-calc";
import { fetchPaginado } from "@/lib/consumo";
import { PageHeader } from "@/components/PageHeader";
import { LayoutDashboard } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

type EpiRow = {
  id: string; nome: string; estoque_atual: number; estoque_minimo: number;
  custo_unitario: number | null; categoria: string | null; codigo_produto?: string | null;
  dias_seguranca?: number | null;
};

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MESES_CURTO = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const ENTRADA_TIPOS = new Set(["entrada_estoque", "ajuste_entrada", "devolucao_normal"]);
const SAIDA_TIPOS = new Set(["entrega", "ajuste_saida"]);
const COR_ENTRADA = "oklch(0.72 0.17 155)";
const COR_SAIDA = "oklch(0.623 0.188 259)";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function Dashboard() {
  const now = new Date();
  const [mes, setMes] = useState<number>(now.getMonth());
  const [ano, setAno] = useState<number>(now.getFullYear());
  const { metricaDe, lead, pedidos } = useEpiMetrics();

  const periodo = useMemo(() => ({
    inicio: new Date(ano, mes, 1, 0, 0, 0).toISOString(),
    fim: new Date(ano, mes + 1, 1, 0, 0, 0).toISOString(),
  }), [ano, mes]);

  // Cadastros (independentes do período)
  const { data: base } = useQuery({
    queryKey: ["dashboard-base"],
    queryFn: async () => {
      const [episRes, colabRes, invRes] = await Promise.all([
        supabase.from("epis").select("id,nome,codigo_produto,estoque_atual,estoque_minimo,custo_unitario,categoria,dias_seguranca").eq("status", "ativo"),
        supabase.from("colaboradores").select("id", { count: "exact", head: true }).eq("status", "ativo"),
        supabase.from("inventarios").select("id,local,data_inicio").eq("status", "em_andamento"),
      ]);
      return {
        epis: (episRes.data ?? []) as EpiRow[],
        colaboradores: colabRes.count ?? 0,
        inventariosPendentes: invRes.data ?? [],
      };
    },
  });

  // Movimentações do período selecionado (paginado em lotes de 1.000)
  const { data: movs = [] } = useQuery({
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
  const { data: evolucaoRaw } = useQuery({
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

  const entregasRecentes = useMemo(
    () => movs.filter((m) => m.tipo === "entrega").slice(-8).reverse(),
    [movs],
  );

  const sinais: { label: string; count: number; sev: Sev; to: LinkTo; search?: Record<string, string> }[] = [
    { label: "Ruptura próxima", count: estoque.ruptura.length, sev: "critical", to: "/compras", search: { prioridade: "alta" } },
    { label: "Estoque zerado", count: estoque.zerados.length, sev: "critical", to: "/epis", search: { nivel: "zerado" } },
    { label: "Estoque crítico", count: estoque.criticos.length, sev: "critical", to: "/epis", search: { nivel: "critico" } },
    { label: "Pedido atrasado", count: pedidosInfo.atrasados.length, sev: "critical", to: "/compras" },
    { label: "Pedidos em aberto", count: pedidosInfo.abertos.length, sev: "neutral", to: "/compras" },
    { label: "Inventário em andamento", count: inventariosPendentes.length, sev: "neutral", to: "/inventario" },
  ];

  const totalNiveis = epis.length || 1;
  const maxCat = Math.max(1, ...periodoStats.consumoCategoria.map((c) => c.qtd));

  return (
    <div className="p-4 md:p-6 xl:p-8 space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title="Central de Controle"
        subtitle="Visão operacional de estoque, entregas e reposição."
        meta={`Período de referência: ${periodoLabel} · ${epis.length} EPIs ativos · ${base?.colaboradores ?? 0} colaboradores`}
        actions={
          <>
            <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
              <SelectTrigger className="w-36 h-9" aria-label="Mês de referência"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="w-24 h-9" aria-label="Ano de referência"><SelectValue /></SelectTrigger>
              <SelectContent>{anos.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </>
        }
      />

      {/* Faixa de indicadores */}
      <section className="grid grid-cols-2 lg:grid-cols-4 rounded-lg border bg-card divide-x divide-y lg:divide-y-0 overflow-hidden">
        <Stat label="Estoque total" value={estoque.estoqueTotal.toLocaleString("pt-BR")} unit="un" hint={`Valor ${brl(estoque.valorTotal)}`} />
        <Stat label="Entregas no período" value={periodoStats.totalEntregas.toLocaleString("pt-BR")} unit="un" hint={`${periodoLabel} · ${brl(periodoStats.custo)}`} />
        <Stat label="EPIs críticos" value={String(estoque.criticos.length)} unit="EPIs" sev={estoque.criticos.length ? "critical" : undefined}
          hint={`+ ${estoque.zerados.length} zerados`} to="/epis" search={{ nivel: "critico" }} />
        <Stat label="Compras necessárias" value={String(compras.qtdEpis)} unit="EPIs" sev={compras.alta ? "critical" : undefined}
          hint={`${compras.unidades.toLocaleString("pt-BR")} un sugeridas · ${compras.alta} alta prioridade`} to="/compras" />
      </section>

      {/* Prioridades + Sinais */}
      <section className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <h2 className="type-section">Prioridades</h2>
              <span className="type-label num rounded bg-muted px-1.5 py-0.5">{prioridades.length}</span>
            </div>
            <span className="type-aux hidden sm:block">Reposição a cada {lead.dias} dias</span>
          </div>
          {prioridades.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Nenhum item exige ação. Estoque dentro dos parâmetros.
            </div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_80px_80px_110px] gap-3 px-4 py-2 type-label border-b bg-muted/40">
                <span>EPI</span><span>Sinal</span><span className="text-right">Estoque</span><span className="text-right">Cobertura</span><span />
              </div>
              <ul className="divide-y">
                {prioridades.slice(0, 10).map((p) => {
                  const [s, ...outros] = p.sinais;
                  const dest = ACAO_DESTINO[s.acao];
                  return (
                    <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_80px_80px_110px] gap-x-3 gap-y-1 items-start md:items-center px-4 py-2.5 hover:bg-muted/40">
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${PRIO_DOT[s.prioridade]}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{p.nome}</div>
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
                        <Link to={dest} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">
                          {s.acao} <ChevronRight className="h-3 w-3" />
                        </Link>
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

        <aside className="rounded-lg border bg-card h-fit">
          <div className="px-4 py-3 border-b"><h2 className="type-section">Sinais</h2></div>
          <ul className="divide-y">
            {sinais.map((s) => (
              <li key={s.label}>
                <Link to={s.to} search={s.search as any} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40">
                  <span className="flex items-center gap-2.5 text-sm">
                    <span className={`h-2 w-2 rounded-full ${s.count ? SEV_DOT[s.sev] : "bg-muted-foreground/30"}`} />
                    <span className={s.count ? "" : "text-muted-foreground"}>{s.label}</span>
                  </span>
                  <span className={`num text-sm font-semibold ${s.count ? SEV_TEXT[s.sev] : "text-muted-foreground"}`}>{s.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      {/* Saúde do estoque */}
      <section className="rounded-lg border bg-card px-4 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="type-section">Saúde do estoque</h2>
          <span className="type-aux">{epis.length} EPIs ativos</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {NIVEIS.map((n) => saude[n.key] > 0 && (
            <div key={n.key} className={n.bar} style={{ width: `${(saude[n.key] / totalNiveis) * 100}%` }} title={`${n.label}: ${saude[n.key]}`} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {NIVEIS.map((n) => (
            <Link key={n.key} to="/epis" search={{ nivel: n.key } as any} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40">
              <span className={`h-2.5 w-2.5 rounded-sm ${n.bar}`} />
              <span className="text-sm">{n.label}</span>
              <span className="num text-sm font-semibold ml-auto sm:ml-1">{saude[n.key]}</span>
              <span className="type-aux num">{Math.round((saude[n.key] / totalNiveis) * 100)}%</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Consumo + Entregas recentes */}
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-lg border bg-card">
          <div className="flex items-baseline justify-between px-4 py-3 border-b">
            <h2 className="type-section">Consumo</h2>
            <span className="type-aux">Últimos 6 meses</span>
          </div>
          <div className="px-2 pt-3">
            {evolucao.some((b) => b.entradas || b.saidas) ? (
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={evolucao} margin={{ left: 0, right: 12, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                  <Tooltip cursor={{ fill: "var(--muted)" }} />
                  <Bar dataKey="saidas" name="Saídas" fill={COR_SAIDA} radius={[3, 3, 0, 0]} barSize={22} />
                  <Line type="monotone" dataKey="entradas" name="Entradas" stroke={COR_ENTRADA} strokeWidth={2} dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <Vazio />}
          </div>
          <div className="px-4 pb-4 pt-2">
            <div className="type-label mb-2">Por categoria · {periodoLabel}</div>
            {periodoStats.consumoCategoria.length ? (
              <ul className="space-y-1.5">
                {periodoStats.consumoCategoria.slice(0, 6).map((c) => (
                  <li key={c.categoria} className="grid grid-cols-[minmax(0,140px)_1fr_48px] items-center gap-3 text-sm">
                    <span className="truncate">{c.categoria}</span>
                    <span className="h-1.5 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-primary" style={{ width: `${(c.qtd / maxCat) * 100}%` }} /></span>
                    <span className="num text-right">{c.qtd}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="type-aux">Sem entregas no período.</p>}
          </div>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-baseline justify-between px-4 py-3 border-b">
            <h2 className="type-section">Entregas recentes</h2>
            <Link to="/entregas" className="text-xs font-medium text-primary">Nova entrega</Link>
          </div>
          {entregasRecentes.length ? (
            <ul className="divide-y">
              {entregasRecentes.map((m: any, i: number) => (
                <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)_auto] gap-3 items-center px-4 py-2.5">
                  <span className="num type-aux">{fmtHora(m.data_movimentacao)}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{m.colaboradores?.nome ?? "—"}</div>
                    <div className="type-aux truncate">{m.epis?.nome ?? "—"} · {m.colaboradores?.turno ?? "—"}</div>
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

function Stat({ label, value, unit, hint, sev, to, search }: {
  label: string; value: string; unit: string; hint: string; sev?: Sev; to?: "/epis" | "/compras"; search?: Record<string, string>;
}) {
  const inner = (
    <div className="px-4 py-3.5 h-full">
      <div className="type-label flex items-center gap-1.5">
        {sev && <span className={`h-1.5 w-1.5 rounded-full ${SEV_DOT[sev]}`} />}{label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`type-kpi num ${sev ? SEV_TEXT[sev] : ""}`}>{value}</span>
        <span className="type-aux">{unit}</span>
      </div>
      <div className="type-aux truncate mt-0.5">{hint}</div>
    </div>
  );
  return to ? <Link to={to} search={search as any} className="block hover:bg-muted/40">{inner}</Link> : inner;
}
