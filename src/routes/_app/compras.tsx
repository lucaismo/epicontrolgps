import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileSpreadsheet, FileText, PackagePlus, Save, Search, Check, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth, canManageRegistros } from "@/lib/auth";
import { CATEGORIAS_EPI } from "@/lib/constants";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";


export const Route = createFileRoute("/_app/compras")({
  component: ComprasPage,
  head: () => ({
    meta: [
      { title: "Planejamento de Compras · EPI Control" },
      { name: "description", content: "Planejamento de reposição de EPIs com consumo médio, lead time, pedidos em trânsito e previsão de ruptura." },
      { property: "og:title", content: "Planejamento de Compras · EPI Control" },
      { property: "og:description", content: "Planejamento de reposição de EPIs com consumo médio, lead time, pedidos em trânsito e previsão de ruptura." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const DIA_MS = 86400000;

function diaValidoDoMes(y: number, m: number, dia: number) {
  return new Date(y, m, Math.min(dia, new Date(y, m + 1, 0).getDate()));
}

/**
 * Tempo total sem reposição = dias até o próximo dia de pedido +
 * dias entre esse pedido e o próximo dia de recebimento.
 * Dinâmico em relação à data de hoje; se o dia do pedido já passou, usa o próximo ciclo.
 */
export function calcLeadTime(diaPedido: number, diaRecebimento: number, ref = new Date()) {
  const hoje = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let pedido = diaValidoDoMes(hoje.getFullYear(), hoje.getMonth(), diaPedido);
  if (pedido.getTime() < hoje.getTime()) {
    pedido = diaValidoDoMes(hoje.getFullYear(), hoje.getMonth() + 1, diaPedido);
  }
  let rm = pedido.getMonth();
  let receb = diaValidoDoMes(pedido.getFullYear(), rm, diaRecebimento);
  while (receb.getTime() <= pedido.getTime()) {
    rm += 1;
    receb = diaValidoDoMes(pedido.getFullYear(), rm, diaRecebimento);
  }
  const ateP = Math.round((pedido.getTime() - hoje.getTime()) / DIA_MS);
  const entrega = Math.round((receb.getTime() - pedido.getTime()) / DIA_MS);
  return { diasAtePedido: ateP, diasEntrega: entrega, dias: ateP + entrega, pedido, recebimento: receb };
}

type Epi = {
  id: string; nome: string; categoria: string; codigo_produto: string | null;
  estoque_atual: number; estoque_minimo: number; dias_seguranca: number; status: string;
};

type Pedido = {
  id: string; epi_id: string; quantidade: number; data_pedido: string;
  data_prevista: string | null; status: string;
};

const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR");

function ComprasPage() {
  const { role, user } = useAuth();
  const podeConfigurar = canManageRegistros(role);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [ajustes, setAjustes] = useState<Record<string, number>>({});

  const { data: config } = useQuery({
    queryKey: ["compras-config"],
    queryFn: async () => (await supabase.from("compras_config").select("*").limit(1).maybeSingle()).data,
  });

  const [diaPedido, setDiaPedido] = useState<number | null>(null);
  const [diaReceb, setDiaReceb] = useState<number | null>(null);
  const dp = diaPedido ?? config?.dia_pedido ?? 20;
  const dr = diaReceb ?? config?.dia_recebimento ?? 10;
  const lead = useMemo(() => calcLeadTime(dp, dr), [dp, dr]);

  const { data: epis = [] } = useQuery({
    queryKey: ["compras-epis"],
    queryFn: async () => ((await supabase.from("epis").select("*").eq("status", "ativo").order("nome")).data ?? []) as unknown as Epi[],
  });

  const desde = useMemo(() => new Date(Date.now() - 365 * DIA_MS).toISOString(), []);
  const { data: movs = [] } = useQuery({
    queryKey: ["compras-movs"],
    queryFn: async () => (await supabase.from("movimentacoes")
      .select("epi_id,quantidade,tipo,data_movimentacao")
      .eq("tipo", "entrega")
      .gte("data_movimentacao", desde)
      .limit(20000)).data ?? [],
  });

  const { data: pedidos = [] } = useQuery({
    queryKey: ["compras-pedidos"],
    queryFn: async () => ((await supabase.from("pedidos_compra")
      .select("id,epi_id,quantidade,data_pedido,data_prevista,status")
      .order("data_pedido", { ascending: false })).data ?? []) as unknown as Pedido[],
  });

  const emTransito = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pedidos) {
      if (p.status !== "em_aberto") continue;
      map.set(p.epi_id, (map.get(p.epi_id) ?? 0) + Number(p.quantidade ?? 0));
    }
    return map;
  }, [pedidos]);

  const { data: perfil } = useQuery({
    queryKey: ["compras-perfil", user?.id],
    enabled: !!user?.id,
    queryFn: async () => (await supabase.from("profiles").select("nome").eq("id", user!.id).maybeSingle()).data,
  });
  const emissor = perfil?.nome ?? user?.email ?? "—";

  const consumo = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, { d30: number; d90: number; d365: number }>();
    for (const m of movs as any[]) {
      const t = new Date(m.data_movimentacao).getTime();
      const age = (now - t) / DIA_MS;
      const cur = map.get(m.epi_id) ?? { d30: 0, d90: 0, d365: 0 };
      const q = Number(m.quantidade ?? 0);
      if (age <= 30) cur.d30 += q;
      if (age <= 90) cur.d90 += q;
      cur.d365 += q;
      map.set(m.epi_id, cur);
    }
    return map;
  }, [movs]);

  const linhas = useMemo(() => {
    const arr = epis.map((e) => {
      const c = consumo.get(e.id) ?? { d30: 0, d90: 0, d365: 0 };
      const diario = c.d90 > 0 ? c.d90 / 90 : c.d30 > 0 ? c.d30 / 30 : c.d365 / 365;
      const mensal = diario * 30;
      const transito = emTransito.get(e.id) ?? 0;
      const disponivel = e.estoque_atual + transito;
      const cobertura = diario > 0 ? disponivel / diario : Infinity;
      const diasSeg = Number(e.dias_seguranca ?? 0);
      const estoqueSeg = diario * diasSeg;
      const sugerido = Math.max(0, Math.ceil(diario * lead.dias + estoqueSeg - disponivel));
      let prioridade: "alta" | "media" | "baixa" = "baixa";
      if (cobertura < lead.dias) prioridade = "alta";
      else if (cobertura < lead.dias + diasSeg || e.estoque_atual < e.estoque_minimo) prioridade = "media";
      const ruptura = diario > 0 && Number.isFinite(cobertura)
        ? new Date(Date.now() + cobertura * DIA_MS) : null;
      return { epi: e, c, diario, mensal, transito, disponivel, cobertura, estoqueSeg, sugerido, prioridade, ruptura };
    });
    const ordem = { alta: 0, media: 1, baixa: 2 } as const;
    return arr.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade] || a.cobertura - b.cobertura);
  }, [epis, consumo, emTransito, lead.dias]);

  // ajustes salvos: a quantidade informada manualmente persiste por período (mês/ano)
  const [ajustesCarregados, setAjustesCarregados] = useState(false);
  useEffect(() => {
    if (ajustesCarregados || !linhas.length || salvosLoading) return;
    const map: Record<string, number> = {};
    for (const l of linhas) {
      const s = salvosMap.get(l.epi.id);
      map[l.epi.id] = s ? Number(s.quantidade) : l.sugerido;
    }
    setAjustes(map);
    setAjustesCarregados(true);
  }, [linhas, salvosMap, salvosLoading, ajustesCarregados]);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const persistir = useCallback((epiId: string, quantidade: number, sugestao: number) => {
    clearTimeout(timers.current[epiId]);
    timers.current[epiId] = setTimeout(async () => {
      const { error } = await supabase.from("compras_ajustes").upsert(
        { epi_id: epiId, ano, mes, quantidade, sugestao_registrada: sugestao, usuario_responsavel: user?.id ?? null } as any,
        { onConflict: "epi_id,ano,mes" },
      );
      if (error) toast.error(`Falha ao salvar quantidade: ${error.message}`);
      else qc.invalidateQueries({ queryKey: ["compras-ajustes", ano, mes] });
    }, 700);
  }, [ano, mes, qc, user?.id]);

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const qtdDe = (l: (typeof linhas)[number]) => ajustes[l.epi.id] ?? l.sugerido;

  // divergência entre a sugestão vigente e a sugestão registrada no momento do ajuste
  const divergenciaDe = (l: (typeof linhas)[number]) => {
    const s = salvosMap.get(l.epi.id);
    if (!s) return null;
    const registrada = Number(s.sugestao_registrada);
    return registrada === l.sugerido ? null : { registrada, atual: l.sugerido };
  };

  function restaurarSugestao(l: (typeof linhas)[number]) {
    setAjustes((p) => ({ ...p, [l.epi.id]: l.sugerido }));
    persistir(l.epi.id, l.sugerido, l.sugerido);
  }


  const filtradas = linhas.filter((l) => {
    if (filterCat !== "all" && l.epi.categoria !== filterCat) return false;
    if (search && !`${l.epi.nome} ${l.epi.codigo_produto ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function salvarConfig() {
    if (dp < 1 || dp > 31 || dr < 1 || dr > 31) { toast.error("Informe dias entre 1 e 31"); return; }
    const payload = { dia_pedido: dp, dia_recebimento: dr };
    const { error } = config?.id
      ? await supabase.from("compras_config").update(payload).eq("id", config.id)
      : await supabase.from("compras_config").insert(payload);
    if (error) toast.error(error.message);
    else { toast.success("Configuração salva"); qc.invalidateQueries({ queryKey: ["compras-config"] }); }
  }

  async function registrarPedidos() {
    const itens = filtradas.filter((l) => qtdDe(l) > 0);
    if (!itens.length) { toast.info("Nenhum item com quantidade a solicitar"); return; }
    const { error } = await supabase.from("pedidos_compra").insert(
      itens.map((l) => ({
        epi_id: l.epi.id,
        quantidade: qtdDe(l),
        data_prevista: lead.recebimento.toISOString().slice(0, 10),
        usuario_responsavel: user?.id ?? null,
      })) as any,
    );
    if (error) { toast.error(error.message); return; }
    toast.success(`${itens.length} pedido(s) registrado(s) em aberto`);
    qc.invalidateQueries({ queryKey: ["compras-pedidos"] });
  }

  async function receberPedido(id: string) {
    const { error } = await supabase.from("pedidos_compra")
      .update({ status: "recebido", data_recebimento: new Date().toISOString() } as any).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Pedido marcado como recebido"); qc.invalidateQueries({ queryKey: ["compras-pedidos"] }); }
  }

  async function excluirPedido(id: string) {
    const { error } = await supabase.from("pedidos_compra").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Pedido excluído"); qc.invalidateQueries({ queryKey: ["compras-pedidos"] }); }
  }

  const prioridadeLabel = (p: string) => (p === "alta" ? "🔴 Alta" : p === "media" ? "🟡 Média" : "🟢 Baixa");
  const coberturaLabel = (p: string) => (p === "alta" ? "🔴 Ruptura próxima" : p === "media" ? "🟡 Atenção" : "🟢 Cobertura excelente");

  function pedidoRows() {
    const agora = new Date().toLocaleString("pt-BR");
    return filtradas.filter((l) => qtdDe(l) > 0).map((l) => ({
      "Código do produto": l.epi.codigo_produto ?? "",
      Nome: l.epi.nome,
      Categoria: l.epi.categoria,
      "Estoque atual": l.epi.estoque_atual,
      "Pedido em trânsito": l.transito,
      "Consumo médio diário": Number(l.diario.toFixed(2)),
      "Consumo médio mensal": Number(l.mensal.toFixed(1)),
      "Cobertura (dias)": Number.isFinite(l.cobertura) ? Math.floor(l.cobertura) : "—",
      "Lead time (dias)": lead.dias,
      "Estoque de segurança (dias)": l.epi.dias_seguranca,
      "Previsão de ruptura": l.ruptura ? fmtDate(l.ruptura) : "Sem consumo suficiente para previsão",
      "Quantidade sugerida": l.sugerido,
      "Quantidade ajustada": qtdDe(l),
      Prioridade: prioridadeLabel(l.prioridade).replace(/[^\wÀ-ÿ]/g, "").trim(),
      "Responsável pela emissão": emissor,
      "Data e hora da geração": agora,
    }));
  }

  function gerarExcel() {
    const rows = pedidoRows();
    if (!rows.length) { toast.info("Nenhum item com quantidade a solicitar"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]).map((k) => ({ wch: Math.max(14, k.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedido");
    XLSX.writeFile(wb, `pedido_compras_${Date.now()}.xlsx`);
    toast.success("Pedido gerado em Excel");
  }

  function gerarPdf() {
    const rows = pedidoRows();
    if (!rows.length) { toast.info("Nenhum item com quantidade a solicitar"); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    const w = doc.internal.pageSize.getWidth();
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("EpiControl GPS", 40, 40);
    doc.setFontSize(11); doc.setFont("helvetica", "normal");
    doc.text("Pedido de Compra do Mês", 40, 58);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, w - 40, 40, { align: "right" });
    doc.text(`Responsável: ${emissor}`, w - 40, 54, { align: "right" });
    doc.text(`Lead time considerado: ${lead.dias} dias`, w - 40, 68, { align: "right" });
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 90,
      head: [["Código", "Nome", "Categoria", "Estoque", "Trânsito", "Cons./dia", "Cons./mês", "Cobertura", "Lead", "Seg.(d)", "Ruptura", "Sugerido", "Ajustado", "Prioridade"]],
      body: rows.map((r) => [
        r["Código do produto"], r.Nome, r.Categoria, String(r["Estoque atual"]), String(r["Pedido em trânsito"]),
        String(r["Consumo médio diário"]), String(r["Consumo médio mensal"]), String(r["Cobertura (dias)"]),
        String(r["Lead time (dias)"]), String(r["Estoque de segurança (dias)"]), String(r["Previsão de ruptura"]),
        String(r["Quantidade sugerida"]), String(r["Quantidade ajustada"]), String(r.Prioridade),
      ]),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 40, right: 40 },
    });
    doc.save(`pedido_compras_${Date.now()}.pdf`);
    toast.success("Pedido gerado em PDF");
  }

  const nomeEpi = (id: string) => epis.find((e) => e.id === id)?.nome ?? "—";

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Planejamento de Compras</h1>
        <p className="text-sm text-muted-foreground">Reposição baseada em consumo, lead time total, pedidos em trânsito e previsão de ruptura</p>
      </div>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">Configuração de lead time</h2>
        <div className="grid md:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5"><Label>Dia do envio do pedido</Label>
            <Input type="number" min={1} max={31} value={dp} disabled={!podeConfigurar} onChange={(e) => setDiaPedido(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5"><Label>Dia previsto de recebimento</Label>
            <Input type="number" min={1} max={31} value={dr} disabled={!podeConfigurar} onChange={(e) => setDiaReceb(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Tempo total sem reposição</Label>
            <div className="h-10 flex items-center rounded-md border px-3 text-sm">
              <b className="mr-1">{lead.dias} dias</b>
              <span className="text-muted-foreground text-xs">
                (hoje → {fmtDate(lead.pedido)}: {lead.diasAtePedido}d + entrega {lead.diasEntrega}d → {fmtDate(lead.recebimento)})
              </span>
            </div>
          </div>
          {podeConfigurar && (
            <Button onClick={salvarConfig}><Save className="h-4 w-4 mr-2" /> Salvar configuração</Button>
          )}
        </div>
      </Card>

      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou código…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="md:w-56"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIAS_EPI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={gerarExcel}><FileSpreadsheet className="h-4 w-4 mr-2" /> Gerar Pedido do Mês (Excel)</Button>
        <Button variant="outline" onClick={gerarPdf}><FileText className="h-4 w-4 mr-2" /> PDF</Button>
        {podeConfigurar && (
          <Button onClick={registrarPedidos}><PackagePlus className="h-4 w-4 mr-2" /> Registrar pedidos em aberto</Button>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-3">Código</th>
                <th className="text-left px-3 py-3">EPI</th>
                <th className="text-left px-3 py-3">Categoria</th>
                <th className="text-right px-3 py-3">Estoque</th>
                <th className="text-right px-3 py-3">Em trânsito</th>
                <th className="text-right px-3 py-3">Mínimo</th>
                <th className="text-right px-3 py-3">Cons. mensal</th>
                <th className="text-right px-3 py-3">Cons. diário</th>
                <th className="text-right px-3 py-3">Cobertura</th>
                <th className="text-right px-3 py-3">Lead time</th>
                <th className="text-right px-3 py-3">Est. segurança</th>
                <th className="text-left px-3 py-3">Prev. ruptura</th>
                <th className="text-right px-3 py-3">Sugerido</th>
                <th className="text-right px-3 py-3">A solicitar</th>
                <th className="text-left px-3 py-3">Prioridade</th>
                <th className="text-left px-3 py-3">Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((l) => (
                <tr key={l.epi.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-3 font-mono text-xs">{l.epi.codigo_produto || "—"}</td>
                  <td className="px-3 py-3 font-medium">{l.epi.nome}</td>
                  <td className="px-3 py-3">{l.epi.categoria}</td>
                  <td className="px-3 py-3 text-right">{l.epi.estoque_atual}</td>
                  <td className="px-3 py-3 text-right">{l.transito || "—"}</td>
                  <td className="px-3 py-3 text-right">{l.epi.estoque_minimo}</td>
                  <td className="px-3 py-3 text-right">{l.mensal.toFixed(1)}</td>
                  <td className="px-3 py-3 text-right">{l.diario.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{Number.isFinite(l.cobertura) ? `${Math.floor(l.cobertura)} d` : "—"}</td>
                  <td className="px-3 py-3 text-right">{lead.dias} d</td>
                  <td className="px-3 py-3 text-right">{Math.ceil(l.estoqueSeg)} <span className="text-xs text-muted-foreground">({l.epi.dias_seguranca}d)</span></td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs">
                    {l.ruptura ? fmtDate(l.ruptura) : <span className="text-muted-foreground">Sem consumo suficiente para previsão</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold">{l.sugerido}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" min={0} className="h-8 w-24 text-right ml-auto"
                      value={qtdDe(l)}
                      onChange={(e) => setAjustes((p) => ({ ...p, [l.epi.id]: Math.max(0, Number(e.target.value) || 0) }))}
                    />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{prioridadeLabel(l.prioridade)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{coberturaLabel(l.prioridade)}</td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={16} className="text-center py-12 text-muted-foreground text-sm">Nenhum EPI encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 border-b"><h2 className="font-semibold">Pedidos de compra</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-3">EPI</th>
                <th className="text-right px-3 py-3">Quantidade solicitada</th>
                <th className="text-left px-3 py-3">Data do pedido</th>
                <th className="text-left px-3 py-3">Previsão de recebimento</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-3">{nomeEpi(p.epi_id)}</td>
                  <td className="px-3 py-3 text-right">{p.quantidade}</td>
                  <td className="px-3 py-3">{new Date(p.data_pedido).toLocaleDateString("pt-BR")}</td>
                  <td className="px-3 py-3">{p.data_prevista ? new Date(`${p.data_prevista}T12:00:00`).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="px-3 py-3">
                    <Badge variant={p.status === "em_aberto" ? "secondary" : "outline"}>
                      {p.status === "em_aberto" ? "Em aberto" : "Recebido"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {podeConfigurar && p.status === "em_aberto" && (
                      <Button size="sm" variant="outline" className="mr-2" onClick={() => receberPedido(p.id)}>
                        <Check className="h-4 w-4 mr-1" /> Receber
                      </Button>
                    )}
                    {role === "admin" && (
                      <Button size="sm" variant="ghost" onClick={() => excluirPedido(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {pedidos.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">Nenhum pedido registrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 border-b"><h2 className="font-semibold">Consumo por período</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-3">EPI</th>
                <th className="text-right px-3 py-3">Últimos 30 dias</th>
                <th className="text-right px-3 py-3">Últimos 90 dias</th>
                <th className="text-right px-3 py-3">Últimos 12 meses</th>
                <th className="text-right px-3 py-3">Média diária</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((l) => (
                <tr key={l.epi.id} className="border-t">
                  <td className="px-3 py-3">{l.epi.nome}</td>
                  <td className="px-3 py-3 text-right">{l.c.d30}</td>
                  <td className="px-3 py-3 text-right">{l.c.d90}</td>
                  <td className="px-3 py-3 text-right">{l.c.d365}</td>
                  <td className="px-3 py-3 text-right">{l.diario.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
