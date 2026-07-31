import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Package, AlertTriangle, TrendingUp, DollarSign,
  Users, ArrowDownRight, Boxes,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

type EpiRow = {
  id: string; nome: string; estoque_atual: number; estoque_minimo: number;
  custo_unitario: number | null; categoria: string | null; codigo_produto?: string | null;
};

type FilterKind = "criticos" | "abaixo" | "zerados" | null;

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const ENTRADA_TIPOS = new Set(["entrada_estoque", "ajuste_entrada", "devolucao_normal"]);
const SAIDA_TIPOS = new Set(["entrega", "ajuste_saida"]);

function Dashboard() {
  const [filter, setFilter] = useState<FilterKind>(null);
  const now = new Date();
  const [mes, setMes] = useState<number>(now.getMonth());
  const [ano, setAno] = useState<number>(now.getFullYear());

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);

      const [episRes, movsRes, colabRes] = await Promise.all([
        supabase.from("epis").select("id,nome,codigo_produto,estoque_atual,estoque_minimo,custo_unitario,categoria").eq("status", "ativo"),
        supabase.from("movimentacoes").select("tipo,quantidade,epi_id,colaborador_id,data_movimentacao,epis(nome,custo_unitario),colaboradores(nome,matricula)").gte("data_movimentacao", inicioMes.toISOString()),
        supabase.from("colaboradores").select("id", { count: "exact", head: true }).eq("status", "ativo"),
      ]);

      const epis = (episRes.data ?? []) as EpiRow[];
      const movs = movsRes.data ?? [];
      const totalEpis = epis.length;
      const estoqueTotal = epis.reduce((s, e) => s + (e.estoque_atual ?? 0), 0);
      const abaixoMin = epis.filter((e) => e.estoque_atual < e.estoque_minimo);
      const zerados = epis.filter((e) => e.estoque_atual === 0);
      // Críticos = abaixo do mínimo mas ainda com estoque (> 0). Zerados são separados.
      const criticos = abaixoMin.filter((e) => e.estoque_atual > 0);

      const entregasMes = movs.filter((m) => m.tipo === "entrega");
      const totalEntregas = entregasMes.reduce((s, m) => s + m.quantidade, 0);
      const custoMes = entregasMes.reduce((s: number, m: any) => s + m.quantidade * Number(m.epis?.custo_unitario ?? 0), 0);

      const porEpi = new Map<string, number>();
      entregasMes.forEach((m: any) => {
        const nome = m.epis?.nome ?? "?";
        porEpi.set(nome, (porEpi.get(nome) ?? 0) + m.quantidade);
      });
      const topEpis = [...porEpi.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nome, qtd]) => ({ nome, qtd }));

      return {
        epis,
        totalEpis, estoqueTotal,
        abaixoMinList: abaixoMin, zeradosList: zerados, criticosList: criticos,
        abaixoMin: abaixoMin.length, zerados: zerados.length, criticos: criticos.length,
        totalEntregas, custoMes, topEpis,
        colaboradores: colabRes.count ?? 0,
        criticosPreview: criticos.slice(0, 5),
      };
    },
  });

  // Movimentação mensal por EPI (item 2)
  const { data: movMensal = [] } = useQuery({
    queryKey: ["dashboard-mov-mensal", ano, mes],
    queryFn: async () => {
      const inicio = new Date(ano, mes, 1, 0, 0, 0).toISOString();
      const fim = new Date(ano, mes + 1, 1, 0, 0, 0).toISOString();
      const { data } = await supabase
        .from("movimentacoes")
        .select("tipo,quantidade,epis(nome)")
        .gte("data_movimentacao", inicio)
        .lt("data_movimentacao", fim);
      const rows = data ?? [];
      const agg = new Map<string, { nome: string; entradas: number; saidas: number }>();
      rows.forEach((m: any) => {
        const nome = m.epis?.nome ?? "?";
        const cur = agg.get(nome) ?? { nome, entradas: 0, saidas: 0 };
        if (ENTRADA_TIPOS.has(m.tipo)) cur.entradas += m.quantidade;
        else if (SAIDA_TIPOS.has(m.tipo)) cur.saidas += m.quantidade;
        agg.set(nome, cur);
      });
      return [...agg.values()]
        .sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas))
        .slice(0, 10);
    },
  });

  // Relatório mensal de movimentação individual por colaborador
  const { data: relColab = [] } = useQuery({
    queryKey: ["dashboard-rel-colab", ano, mes],
    queryFn: async () => {
      const inicio = new Date(ano, mes, 1, 0, 0, 0).toISOString();
      const fim = new Date(ano, mes + 1, 1, 0, 0, 0).toISOString();
      const { data } = await supabase
        .from("movimentacoes")
        .select("tipo,quantidade,data_movimentacao,colaborador_id,colaboradores(nome,matricula,turno),epis(nome)")
        .not("colaborador_id", "is", null)
        .gte("data_movimentacao", inicio)
        .lt("data_movimentacao", fim);
      const agg = new Map<string, { nome: string; matricula: string; turno: string; entregas: number; itens: number; devolucoes: number; epis: Set<string> }>();
      (data ?? []).forEach((m: any) => {
        const id = m.colaborador_id as string;
        const cur = agg.get(id) ?? {
          nome: m.colaboradores?.nome ?? "—",
          matricula: m.colaboradores?.matricula ?? "",
          turno: m.colaboradores?.turno ?? "—",
          entregas: 0, itens: 0, devolucoes: 0, epis: new Set<string>(),
        };
        if (m.tipo === "entrega") { cur.entregas += 1; cur.itens += m.quantidade; if (m.epis?.nome) cur.epis.add(m.epis.nome); }
        else cur.devolucoes += 1;
        agg.set(id, cur);
      });
      return [...agg.values()]
        .map((r) => ({ ...r, episTxt: [...r.epis].join(", ") }))
        .sort((a, b) => b.itens - a.itens);
    },
  });

  const anos = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  const modalItems = useMemo(() => {
    if (!stats) return [];
    if (filter === "criticos") return stats.criticosList;
    if (filter === "abaixo") return stats.abaixoMinList;
    if (filter === "zerados") return stats.zeradosList;
    return [];
  }, [filter, stats]);

  const modalTitle =
    filter === "criticos" ? "EPIs críticos (abaixo do mínimo, com estoque)" :
    filter === "abaixo" ? "EPIs abaixo do mínimo" :
    filter === "zerados" ? "EPIs zerados" : "";

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do estoque e movimentações do mês</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KPI icon={Boxes} label="EPIs cadastrados" value={stats?.totalEpis ?? 0} color="bg-primary/10 text-primary" />
        <KPI icon={Package} label="Estoque total" value={stats?.estoqueTotal ?? 0} color="bg-success/10 text-success" />
        <KPI
          icon={AlertTriangle} label="Abaixo do mínimo" value={stats?.abaixoMin ?? 0}
          color={(stats?.abaixoMin ?? 0) > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}
          onClick={() => setFilter("abaixo")}
        />
        <KPI
          icon={AlertTriangle} label="Zerados" value={stats?.zerados ?? 0}
          color={(stats?.zerados ?? 0) > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}
          onClick={() => setFilter("zerados")}
        />
        <KPI icon={ArrowDownRight} label="Entregas no mês" value={stats?.totalEntregas ?? 0} color="bg-primary/10 text-primary" />
        <KPI icon={DollarSign} label="Custo estimado mês" value={`R$ ${(stats?.custoMes ?? 0).toFixed(2)}`} color="bg-success/10 text-success" />
        <KPI icon={Users} label="Colaboradores ativos" value={stats?.colaboradores ?? 0} color="bg-secondary/15 text-secondary" />
        <KPI
          icon={TrendingUp} label="EPIs críticos" value={stats?.criticos ?? 0}
          color="bg-warning/15 text-warning"
          onClick={() => setFilter("criticos")}
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h3 className="font-semibold">Movimentação mensal por EPI</h3>
          <div className="flex gap-2">
            <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MESES.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {anos.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {movMensal.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={movMensal}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="nome" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="entradas" name="Entradas" fill="oklch(0.72 0.17 155)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="saidas" name="Saídas" fill="oklch(0.623 0.188 259)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground py-12 text-center">Sem movimentações no período selecionado.</p>
        )}
      </Card>

      <div className="grid gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-4">EPIs mais entregues no mês</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats?.topEpis ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="qtd" fill="oklch(0.623 0.188 259)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5 overflow-hidden">
          <h3 className="font-semibold mb-4">
            Movimentação por colaborador · {MESES[mes]}/{ano}
          </h3>
          {relColab.length ? (
            <div className="overflow-x-auto">
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
                  {relColab.map((c) => (
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
          ) : (
            <p className="text-sm text-muted-foreground py-12 text-center">Sem movimentações no período selecionado.</p>
          )}
        </Card>
      </div>

      {stats?.criticosPreview.length ? (
        <Card className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> EPIs em estado crítico
          </h3>
          <div className="space-y-2">
            {stats.criticosPreview.map((e) => (
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
      ) : null}

      <Dialog open={filter !== null} onOpenChange={(o) => !o && setFilter(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{modalTitle}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto -mx-6 px-6">
            {modalItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhum EPI nessa condição.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">EPI</th>
                    <th className="text-left px-3 py-2">Código</th>
                    <th className="text-left px-3 py-2">Categoria</th>
                    <th className="text-right px-3 py-2">Estoque atual</th>
                    <th className="text-right px-3 py-2">Estoque mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {modalItems.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{e.nome}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.codigo_produto || "—"}</td>
                      <td className="px-3 py-2">{e.categoria ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{e.estoque_atual}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{e.estoque_minimo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KPI({ icon: Icon, label, value, color, onClick }: { icon: any; label: string; value: number | string; color: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className={`h-9 w-9 rounded-md grid place-items-center mb-3 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="text-left focus:outline-none focus:ring-2 focus:ring-primary/50 rounded-lg">
        <Card className="p-4 hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
          {inner}
        </Card>
      </button>
    );
  }
  return <Card className="p-4">{inner}</Card>;
}

export function StockBadge({ atual, minimo }: { atual: number; minimo: number }) {
  let cls = "bg-success/15 text-success border-success/30";
  let txt = "Normal";
  if (atual === 0) { cls = "bg-destructive/10 text-destructive border-destructive/30"; txt = "Zerado"; }
  else if (atual < minimo) { cls = "bg-warning/15 text-warning border-warning/40"; txt = "Crítico"; }
  else if (atual < minimo * 1.5) { cls = "bg-warning/10 text-warning border-warning/30"; txt = "Atenção"; }
  return (
    <div className="text-right">
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" /> {txt}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{atual} / mín {minimo}</div>
    </div>
  );
}
