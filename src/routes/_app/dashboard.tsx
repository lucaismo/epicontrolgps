import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Package, AlertTriangle, TrendingUp, DollarSign,
  Users, ArrowDownRight, Boxes,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);

      const [episRes, movsRes, colabRes] = await Promise.all([
        supabase.from("epis").select("id,nome,estoque_atual,estoque_minimo,custo_unitario,categoria").eq("status", "ativo"),
        supabase.from("movimentacoes").select("tipo,quantidade,epi_id,colaborador_id,data_movimentacao,epis(nome,custo_unitario),colaboradores(funcao)").gte("data_movimentacao", inicioMes.toISOString()),
        supabase.from("colaboradores").select("id", { count: "exact", head: true }).eq("status", "ativo"),
      ]);

      const epis = episRes.data ?? [];
      const movs = movsRes.data ?? [];
      const totalEpis = epis.length;
      const estoqueTotal = epis.reduce((s, e) => s + (e.estoque_atual ?? 0), 0);
      const abaixoMin = epis.filter((e) => e.estoque_atual < e.estoque_minimo);
      const zerados = epis.filter((e) => e.estoque_atual === 0);

      const entregasMes = movs.filter((m) => m.tipo === "entrega");
      const totalEntregas = entregasMes.reduce((s, m) => s + m.quantidade, 0);
      const custoMes = entregasMes.reduce((s: number, m: any) => s + m.quantidade * Number(m.epis?.custo_unitario ?? 0), 0);

      const porEpi = new Map<string, number>();
      entregasMes.forEach((m: any) => {
        const nome = m.epis?.nome ?? "?";
        porEpi.set(nome, (porEpi.get(nome) ?? 0) + m.quantidade);
      });
      const topEpis = [...porEpi.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nome, qtd]) => ({ nome, qtd }));

      const porFuncao = new Map<string, number>();
      entregasMes.forEach((m: any) => {
        const funcao = m.colaboradores?.funcao ?? "Sem função";
        porFuncao.set(funcao, (porFuncao.get(funcao) ?? 0) + m.quantidade);
      });
      const setores = [...porFuncao.entries()].map(([name, value]) => ({ name, value }));

      return {
        totalEpis, estoqueTotal, abaixoMin: abaixoMin.length, zerados: zerados.length,
        totalEntregas, custoMes, topEpis, setores,
        colaboradores: colabRes.count ?? 0,
        criticos: abaixoMin.slice(0, 5),
      };
    },
  });

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do estoque e movimentações do mês</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KPI icon={Boxes} label="EPIs cadastrados" value={stats?.totalEpis ?? 0} color="bg-primary/10 text-primary" />
        <KPI icon={Package} label="Estoque total" value={stats?.estoqueTotal ?? 0} color="bg-success/10 text-success" />
        <KPI icon={AlertTriangle} label="Abaixo do mínimo" value={stats?.abaixoMin ?? 0} color={(stats?.abaixoMin ?? 0) > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"} />
        <KPI icon={AlertTriangle} label="Zerados" value={stats?.zerados ?? 0} color={(stats?.zerados ?? 0) > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"} />
        <KPI icon={ArrowDownRight} label="Entregas no mês" value={stats?.totalEntregas ?? 0} color="bg-primary/10 text-primary" />
        <KPI icon={DollarSign} label="Custo estimado mês" value={`R$ ${(stats?.custoMes ?? 0).toFixed(2)}`} color="bg-success/10 text-success" />
        <KPI icon={Users} label="Colaboradores ativos" value={stats?.colaboradores ?? 0} color="bg-secondary/15 text-secondary" />
        <KPI icon={TrendingUp} label="EPIs críticos" value={stats?.abaixoMin ?? 0} color="bg-warning/15 text-warning" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
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

        <Card className="p-5">
          <h3 className="font-semibold mb-4">Consumo por função</h3>
          {stats?.setores.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={stats.setores} dataKey="value" nameKey="name" outerRadius={90}>
                  {stats.setores.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-12 text-center">Sem entregas no mês.</p>
          )}
        </Card>
      </div>

      {stats?.criticos.length ? (
        <Card className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> EPIs em estado crítico
          </h3>
          <div className="space-y-2">
            {stats.criticos.map((e) => (
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
    </div>
  );
}

function KPI({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <Card className="p-4">
      <div className={`h-9 w-9 rounded-md grid place-items-center mb-3 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </Card>
  );
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
