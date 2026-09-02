import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ComponentType } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Package, AlertTriangle, DollarSign, Users, ArrowDownRight, Boxes,
  ArrowLeftRight, ChevronRight, CalendarClock, ClipboardList, XCircle, CheckCircle2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line,
} from "recharts";
import { useEpiMetrics } from "@/hooks/use-epi-metrics";
import { DIA_MS, nivelEstoque } from "@/lib/estoque-calc";
import { StockBadge } from "@/components/StockBadge";

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
  const { metricaDe, lead } = useEpiMetrics();

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

  // Movimentações do período selecionado
  const { data: movs = [] } = useQuery({
    queryKey: ["dashboard-movs", ano, mes],
    queryFn: async () => {
      const { data } = await supabase
        .from("movimentacoes")
        .select("tipo,quantidade,epi_id,colaborador_id,data_movimentacao,epis(nome,categoria,custo_unitario),colaboradores(nome,matricula,turno)")
        .gte("data_movimentacao", periodo.inicio)
        .lt("data_movimentacao", periodo.fim)
        .limit(20000);
      return (data ?? []) as any[];
    },
  });

  // Evolução: últimos 6 meses até o período selecionado
  const { data: evolucao = [] } = useQuery({
    queryKey: ["dashboard-evolucao", ano, mes],
    queryFn: async () => {
      const inicio6 = new Date(ano, mes - 5, 1, 0, 0, 0);
      const { data } = await supabase
        .from("movimentacoes")
        .select("tipo,quantidade,data_movimentacao")
        .gte("data_movimentacao", inicio6.toISOString())
        .lt("data_movimentacao", periodo.fim)
        .limit(50000);
      const buckets: { key: string; label: string; entradas: number; saidas: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(ano, mes - i, 1);
        buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MESES_CURTO[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, entradas: 0, saidas: 0 });
      }
      const idx = new Map(buckets.map((b, i) => [b.key, i]));
      for (const m of (data ?? []) as any[]) {
        const d = new Date(m.data_movimentacao);
        const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
        if (i === undefined) continue;
        if (ENTRADA_TIPOS.has(m.tipo)) buckets[i].entradas += m.quantidade;
        else if (SAIDA_TIPOS.has(m.tipo)) buckets[i].saidas += m.quantidade;
      }
      return buckets;
    },
  });

  const epis = base?.epis ?? [];

  const estoque = useMemo(() => {
    const zerados = epis.filter((e) => nivelEstoque(e.estoque_atual, e.estoque_minimo) === "zerado");
    const criticos = epis.filter((e) => nivelEstoque(e.estoque_atual, e.estoque_minimo) === "critico");
    const abaixoMin = epis.filter((e) => e.estoque_atual < e.estoque_minimo);
    const valorTotal = epis.reduce((s, e) => s + e.estoque_atual * Number(e.custo_unitario ?? 0), 0);
    const estoqueTotal = epis.reduce((s, e) => s + (e.estoque_atual ?? 0), 0);
    // Ruptura prevista dentro do ciclo de reposição (mesma métrica do módulo Compras)
    const ruptura = epis
      .map((e) => ({ epi: e, m: metricaDe(e) }))
      .filter(({ epi, m }) => m.ruptura !== null && epi.estoque_atual > 0 && m.cobertura < lead.dias)
      .sort((a, b) => a.m.cobertura - b.m.cobertura);
    return { zerados, criticos, abaixoMin, valorTotal, estoqueTotal, ruptura };
  }, [epis, metricaDe, lead.dias]);

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
  const temAlertas = estoque.zerados.length + estoque.criticos.length + estoque.ruptura.length + estoque.abaixoMin.length + inventariosPendentes.length > 0;

  return (
    <div className="p-4 md:p-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Situação do estoque de EPIs e o que precisa de ação hoje.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Período de referência</span>
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{MESES.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{anos.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </header>

      {/* Indicadores principais */}
      <section className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <KPI icon={Boxes} label="EPIs cadastrados" value={epis.length} tone="neutral" />
          <KPI icon={Package} label="Estoque total" value={estoque.estoqueTotal} hint="unidades em estoque" tone="neutral" />
          <KPI icon={DollarSign} label="Valor total do estoque" value={brl(estoque.valorTotal)} hint="estoque × custo unitário" tone="neutral" />
          <KPI
            icon={AlertTriangle} label="EPIs críticos" value={estoque.criticos.length}
            hint="abaixo do mínimo, com estoque"
            tone={estoque.criticos.length > 0 ? "warning" : "ok"}
            to="/epis" search={{ nivel: "critico" }}
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <KPI
            icon={XCircle} label="EPIs zerados" value={estoque.zerados.length}
            hint="sem estoque disponível"
            tone={estoque.zerados.length > 0 ? "danger" : "ok"}
            to="/epis" search={{ nivel: "zerado" }}
          />
          <KPI icon={ArrowDownRight} label="Entregas no mês" value={periodoStats.totalEntregas} hint={`${periodoLabel} · ${brl(periodoStats.custo)}`} tone="info" />
          <KPI icon={Users} label="Colaboradores ativos" value={base?.colaboradores ?? 0} tone="info" to="/colaboradores" />
          <KPI icon={ArrowLeftRight} label="Movimentações no período" value={periodoStats.totalMovs} hint={periodoLabel} tone="info" />
        </div>
      </section>

      {/* Atenção necessária */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className={`h-4 w-4 ${temAlertas ? "text-warning" : "text-muted-foreground"}`} />
          <h2 className="font-semibold text-base">Atenção necessária</h2>
        </div>
        {!temAlertas ? (
          <Card className="p-6 flex items-center gap-3 text-sm text-muted-foreground border-success/30 bg-success/5">
            <CheckCircle2 className="h-5 w-5 text-success" /> Nenhum item exige ação no momento. Estoque dentro dos parâmetros.
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {estoque.zerados.length > 0 && (
              <AlertaCard
                titulo="EPIs zerados" tone="danger" count={estoque.zerados.length}
                to="/epis" search={{ nivel: "zerado" }}
                itens={estoque.zerados.slice(0, 5).map((e) => ({ id: e.id, nome: e.nome, sub: e.categoria ?? "", right: `mín ${e.estoque_minimo}` }))}
              />
            )}
            {estoque.criticos.length > 0 && (
              <AlertaCard
                titulo="EPIs críticos" tone="warning" count={estoque.criticos.length}
                to="/epis" search={{ nivel: "critico" }}
                itens={estoque.criticos.slice(0, 5).map((e) => ({ id: e.id, nome: e.nome, sub: e.categoria ?? "", right: `${e.estoque_atual} / mín ${e.estoque_minimo}` }))}
              />
            )}
            {estoque.ruptura.length > 0 && (
              <AlertaCard
                titulo="Ruptura prevista no ciclo" tone="warning" count={estoque.ruptura.length}
                descricao={`Acaba antes da próxima reposição (${lead.dias} dias).`}
                to="/compras" search={{ prioridade: "alta" }}
                itens={estoque.ruptura.slice(0, 5).map(({ epi, m }) => ({
                  id: epi.id, nome: epi.nome,
                  sub: `${Math.floor(m.cobertura)} dias de cobertura`,
                  right: m.ruptura ? fmtData(m.ruptura) : "—",
                }))}
              />
            )}
            {estoque.abaixoMin.length > 0 && (
              <AlertaCard
                titulo="Abaixo do mínimo" tone="muted" count={estoque.abaixoMin.length}
                descricao="Inclui zerados e críticos."
                to="/epis" search={{ nivel: "abaixo" }}
                itens={estoque.abaixoMin.slice(0, 5).map((e) => ({ id: e.id, nome: e.nome, sub: e.categoria ?? "", right: `${e.estoque_atual} / ${e.estoque_minimo}` }))}
              />
            )}
            {inventariosPendentes.length > 0 && (
              <AlertaCard
                titulo="Inventários em andamento" tone="info" count={inventariosPendentes.length}
                icon={ClipboardList}
                to="/inventario"
                itens={inventariosPendentes.slice(0, 5).map((i: any) => ({
                  id: i.id, nome: i.local, sub: `iniciado em ${new Date(i.data_inicio).toLocaleDateString("pt-BR")}`,
                  right: `${Math.floor((Date.now() - new Date(i.data_inicio).getTime()) / DIA_MS)} d`,
                }))}
              />
            )}
          </div>
        )}
      </section>

      {/* Gráficos */}
      <section className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="mb-4">
            <h3 className="font-semibold">Consumo por categoria</h3>
            <p className="text-xs text-muted-foreground">Unidades entregues em {periodoLabel}</p>
          </div>
          {periodoStats.consumoCategoria.length ? (
            <ResponsiveContainer width="100%" height={Math.max(200, periodoStats.consumoCategoria.length * 34)}>
              <BarChart data={periodoStats.consumoCategoria} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="categoria" width={130} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="qtd" name="Entregues" fill={COR_SAIDA} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Vazio />}
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <h3 className="font-semibold">Evolução das movimentações</h3>
            <p className="text-xs text-muted-foreground">Entradas × saídas nos últimos 6 meses</p>
          </div>
          {evolucao.some((b) => b.entradas || b.saidas) ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={evolucao} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="entradas" name="Entradas" stroke={COR_ENTRADA} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="saidas" name="Saídas" stroke={COR_SAIDA} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Vazio />}
        </Card>
      </section>

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="font-semibold">Movimentação mensal por EPI</h3>
          <p className="text-xs text-muted-foreground">10 EPIs com mais movimentação em {periodoLabel}</p>
        </div>
        {periodoStats.movPorEpi.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={periodoStats.movPorEpi}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="nome" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip cursor={{ fill: "var(--muted)" }} />
              <Legend />
              <Bar dataKey="entradas" name="Entradas" fill={COR_ENTRADA} radius={[6, 6, 0, 0]} />
              <Bar dataKey="saidas" name="Saídas" fill={COR_SAIDA} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Vazio />}
      </Card>

      <Card className="p-5 overflow-hidden">
        <div className="mb-4">
          <h3 className="font-semibold">Movimentação por colaborador</h3>
          <p className="text-xs text-muted-foreground">{periodoLabel}</p>
        </div>
        {periodoStats.relColab.length ? (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Colaborador</th>
                  <th className="text-left px-3 py-2">Matrícula</th>
                  <th className="text-left px-3 py-2">Turno</th>
                  <th className="text-right px-3 py-2">Entregas</th>
                  <th className="text-right px-3 py-2">Itens</th>
                  <th className="text-right px-3 py-2">Devoluções/Trocas</th>
                  <th className="text-left px-3 py-2">EPIs recebidos</th>
                </tr>
              </thead>
              <tbody>
                {periodoStats.relColab.map((c) => (
                  <tr key={c.matricula + c.nome} className="border-t">
                    <td className="px-3 py-2 font-medium">{c.nome}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.matricula}</td>
                    <td className="px-3 py-2">{c.turno}</td>
                    <td className="px-3 py-2 text-right">{c.entregas}</td>
                    <td className="px-3 py-2 text-right font-semibold">{c.itens}</td>
                    <td className="px-3 py-2 text-right">{c.devolucoes}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.episTxt || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vazio />}
      </Card>

      {estoque.criticos.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> EPIs em estado crítico
          </h3>
          <div className="space-y-2">
            {estoque.criticos.slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{e.nome}</div>
                  <div className="text-xs text-muted-foreground">{e.categoria}</div>
                </div>
                <StockBadge atual={e.estoque_atual} minimo={e.estoque_minimo} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Vazio() {
  return <p className="text-sm text-muted-foreground py-12 text-center">Sem movimentações no período selecionado.</p>;
}

type Tone = "neutral" | "info" | "ok" | "warning" | "danger" | "muted";
const TONE_ICON: Record<Tone, string> = {
  neutral: "bg-muted text-foreground",
  info: "bg-primary/10 text-primary",
  ok: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};
const TONE_CARD: Record<Tone, string> = {
  neutral: "",
  info: "",
  ok: "",
  warning: "border-warning/50 bg-warning/5",
  danger: "border-destructive/50 bg-destructive/5",
  muted: "",
};

type LinkTarget = { to: "/epis" | "/compras" | "/inventario" | "/colaboradores"; search?: Record<string, string> };

function KPI({ icon: Icon, label, value, hint, tone, to, search }: {
  icon: ComponentType<{ className?: string }>; label: string; value: number | string; hint?: string; tone: Tone;
} & Partial<LinkTarget>) {
  const destaque = tone === "warning" || tone === "danger";
  const inner = (
    <Card className={`p-4 h-full transition-all ${TONE_CARD[tone]} ${to ? "hover:shadow-md hover:border-primary/40" : ""}`}>
      <div className="flex items-start justify-between">
        <div className={`h-9 w-9 rounded-md grid place-items-center ${TONE_ICON[tone]}`}><Icon className="h-4 w-4" /></div>
        {to && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className={`mt-3 font-bold tracking-tight ${destaque ? "text-3xl" : "text-2xl"}`}>{value}</div>
      <div className="text-xs font-medium mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </Card>
  );
  if (!to) return inner;
  return (
    <Link to={to} search={search as any} className="block text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50">
      {inner}
    </Link>
  );
}

function AlertaCard({ titulo, descricao, count, tone, itens, to, search, icon: Icon = AlertTriangle }: {
  titulo: string; descricao?: string; count: number; tone: Tone;
  itens: { id: string; nome: string; sub: string; right: string }[];
  icon?: ComponentType<{ className?: string }>;
} & LinkTarget) {
  return (
    <Link to={to} search={search as any} className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50">
      <Card className={`p-4 h-full hover:shadow-md transition-all ${TONE_CARD[tone]}`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-8 w-8 shrink-0 rounded-md grid place-items-center ${TONE_ICON[tone]}`}><Icon className="h-4 w-4" /></div>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{titulo}</div>
              {descricao && <div className="text-[11px] text-muted-foreground truncate">{descricao}</div>}
            </div>
          </div>
          <span className={`shrink-0 text-lg font-bold tabular-nums ${tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : ""}`}>{count}</span>
        </div>
        <ul className="space-y-1.5">
          {itens.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">{i.nome}</div>
                {i.sub && <div className="text-[11px] text-muted-foreground truncate">{i.sub}</div>}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">{i.right}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 pt-2 border-t text-xs text-primary font-medium flex items-center gap-1">
          {count > itens.length ? `Ver todos (${count})` : "Abrir"} <ChevronRight className="h-3 w-3" />
          <CalendarClock className="hidden" />
        </div>
      </Card>
    </Link>
  );
}
