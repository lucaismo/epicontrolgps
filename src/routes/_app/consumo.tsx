import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORIAS_EPI } from "@/lib/constants";
import { fetchEntregasDesde } from "@/lib/consumo";
import { useEpiMetrics } from "@/hooks/use-epi-metrics";
import { CONSUMO_ZERO } from "@/lib/estoque-calc";
import { fmtNum } from "@/components/metrics";

export const Route = createFileRoute("/_app/consumo")({
  component: ConsumoPage,
  head: () => ({
    meta: [
      { title: "Consumo mensal · EPI Control" },
      { name: "description", content: "Consumo mensal de EPIs por item e tamanho, reconstruído a partir das entregas registradas." },
      { property: "og:title", content: "Consumo mensal · EPI Control" },
      { property: "og:description", content: "Consumo mensal de EPIs por item e tamanho, a partir das entregas reais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function ConsumoPage() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth()); // 0-11
  const [cat, setCat] = useState("all");
  const [busca, setBusca] = useState("");
  const [tam, setTam] = useState("all");
  const [visao, setVisao] = useState<"anual" | "mes">("anual");
  const { consumo: janelas } = useEpiMetrics();

  const { data: epis = [] } = useQuery({
    queryKey: ["consumo-epis"],
    queryFn: async () => (await supabase.from("epis").select("id,nome,categoria,tamanho,estoque_atual,codigo_produto").order("nome")).data ?? [],
  });

  const { data: movs = [], isLoading } = useQuery({
    queryKey: ["consumo-ano", ano],
    queryFn: () => fetchEntregasDesde(new Date(ano, 0, 1).toISOString()),
  });

  // matriz epi x mês (somente entregas = saída real)
  const matriz = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of movs) {
      const d = new Date(r.data_movimentacao);
      if (d.getFullYear() !== ano) continue;
      const arr = m.get(r.epi_id) ?? Array(12).fill(0);
      arr[d.getMonth()] += Number(r.quantidade ?? 0);
      m.set(r.epi_id, arr);
    }
    return m;
  }, [movs, ano]);

  const mesesVisiveis = ano === hoje.getFullYear() ? hoje.getMonth() + 1 : 12;
  const tamanhos = useMemo(() => Array.from(new Set(epis.map((e) => e.tamanho).filter(Boolean))).sort() as string[], [epis]);

  const linhas = useMemo(() => epis
    .filter((e) => cat === "all" || e.categoria === cat)
    .filter((e) => tam === "all" || e.tamanho === tam)
    .filter((e) => !busca || `${e.nome} ${e.codigo_produto ?? ""}`.toLowerCase().includes(busca.toLowerCase()))
    .map((e) => {
      const meses = matriz.get(e.id) ?? Array(12).fill(0);
      const total = meses.reduce((a, b) => a + b, 0);
      return { e, meses, total, media: total / mesesVisiveis, j: janelas.get(e.id) ?? CONSUMO_ZERO };
    })
    .filter((l) => visao === "mes" ? true : l.total > 0 || busca || cat !== "all")
    .sort((a, b) => (visao === "mes" ? b.meses[mes] - a.meses[mes] : b.total - a.total)),
  [epis, cat, tam, busca, matriz, mesesVisiveis, janelas, visao, mes]);

  const totMes = Array.from({ length: 12 }, (_, i) => linhas.reduce((s, l) => s + l.meses[i], 0));
  const totAno = totMes.reduce((a, b) => a + b, 0);
  const anos = Array.from({ length: 4 }, (_, i) => hoje.getFullYear() - i);

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Consumo mensal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Baseado apenas nas entregas registradas. Entradas, ajustes de inventário e o destino do EPI anterior (troca) não contam como consumo.
        </p>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <Tabs value={visao} onValueChange={(v) => setVisao(v as any)}>
          <TabsList><TabsTrigger value="anual">Por EPI × mês</TabsTrigger><TabsTrigger value="mes">Visão do mês</TabsTrigger></TabsList>
        </Tabs>
        <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{MESES.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIAS_EPI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tam} onValueChange={setTam}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Tamanho" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos tamanhos</SelectItem>
            {tamanhos.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="flex-1 min-w-[180px]" placeholder="Buscar EPI…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-3xl font-bold tabular-nums">{fmtNum(totAno)}</div><div className="text-sm mt-1">Unidades entregues em {ano}</div></Card>
        <Card className="p-4"><div className="text-3xl font-bold tabular-nums">{fmtNum(totMes[mes])}</div><div className="text-sm mt-1">Unidades em {MESES[mes]}/{ano}</div></Card>
        <Card className="p-4"><div className="text-3xl font-bold tabular-nums">{fmtNum(totAno / mesesVisiveis, 1)}</div><div className="text-sm mt-1">Média mensal ({mesesVisiveis} meses)</div></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {visao === "anual" ? (
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th className="text-left">EPI</th><th className="text-left">Tamanho</th>
                  {MESES.slice(0, mesesVisiveis).map((m, i) => <th key={m} className={`num ${i === mes ? "text-primary" : ""}`}>{m}</th>)}
                  <th className="num">Total</th><th className="num">Média mensal</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.e.id}>
                    <td className="font-medium">{l.e.nome}<div className="text-xs text-muted-foreground font-normal">{l.e.categoria}</div></td>
                    <td>{l.e.tamanho || "Único"}</td>
                    {l.meses.slice(0, mesesVisiveis).map((v, i) => <td key={i} className={`num ${v ? "" : "text-muted-foreground"}`}>{v || "·"}</td>)}
                    <td className="num text-base font-bold">{fmtNum(l.total)}</td>
                    <td className="num font-semibold">{fmtNum(l.media, 1)}</td>
                  </tr>
                ))}
                {linhas.length > 0 && (
                  <tr className="bg-muted/40 font-semibold">
                    <td colSpan={2}>Total</td>
                    {totMes.slice(0, mesesVisiveis).map((v, i) => <td key={i} className="num">{fmtNum(v)}</td>)}
                    <td className="num">{fmtNum(totAno)}</td><td className="num">{fmtNum(totAno / mesesVisiveis, 1)}</td>
                  </tr>
                )}
                {!linhas.length && <tr><td colSpan={mesesVisiveis + 4} className="text-center py-12 text-muted-foreground">{isLoading ? "Carregando…" : "Sem entregas no período."}</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th className="text-left">EPI</th><th className="text-left">Tamanho</th>
                  <th className="num">Estoque atual</th><th className="num">Consumo {MESES[mes]}/{ano}</th>
                  <th className="num">Média 30d</th><th className="num">Média 90d</th><th className="num">Média 365d</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.e.id}>
                    <td className="font-medium">{l.e.nome}<div className="text-xs text-muted-foreground font-normal">{l.e.categoria}</div></td>
                    <td>{l.e.tamanho || "Único"}</td>
                    <td className="num font-semibold">{fmtNum(l.e.estoque_atual)}</td>
                    <td className="num text-base font-bold">{fmtNum(l.meses[mes])}</td>
                    <td className="num">{fmtNum(l.j.d30)}<div className="text-xs text-muted-foreground">{fmtNum(l.j.d30 / 30, 2)}/dia</div></td>
                    <td className="num">{fmtNum(l.j.d90 / 3, 1)}<span className="text-xs text-muted-foreground">/mês</span><div className="text-xs text-muted-foreground">{fmtNum(l.j.d90 / 90, 2)}/dia</div></td>
                    <td className="num">{fmtNum(l.j.d365 / 12, 1)}<span className="text-xs text-muted-foreground">/mês</span><div className="text-xs text-muted-foreground">{fmtNum(l.j.d365 / 365, 2)}/dia</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
