import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, FileText, Save, Search } from "lucide-react";
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
      { name: "description", content: "Sugestão automática de compra de EPIs com base em consumo médio, lead time e estoque de segurança." },
      { property: "og:title", content: "Planejamento de Compras · EPI Control" },
      { property: "og:description", content: "Sugestão automática de compra de EPIs com base em consumo, lead time e estoque de segurança." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const DIA_MS = 86400000;

/** Intervalo em dias entre o dia do pedido e o próximo dia de recebimento. */
export function calcLeadTime(diaPedido: number, diaRecebimento: number, ref = new Date()) {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const pedido = new Date(y, m, Math.min(diaPedido, new Date(y, m + 1, 0).getDate()));
  let rm = m;
  // recebimento é o próximo dia "diaRecebimento" após o pedido
  let receb = new Date(y, rm, Math.min(diaRecebimento, new Date(y, rm + 1, 0).getDate()));
  while (receb.getTime() <= pedido.getTime()) {
    rm += 1;
    receb = new Date(y, rm, Math.min(diaRecebimento, new Date(y, rm + 1, 0).getDate()));
  }
  return {
    dias: Math.round((receb.getTime() - pedido.getTime()) / DIA_MS),
    pedido,
    recebimento: receb,
  };
}

type Epi = {
  id: string; nome: string; categoria: string; codigo_produto: string | null;
  estoque_atual: number; estoque_minimo: number; dias_seguranca: number; status: string;
};

function ComprasPage() {
  const { role, user } = useAuth();
  const podeConfigurar = canManageRegistros(role);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");

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
    return epis.map((e) => {
      const c = consumo.get(e.id) ?? { d30: 0, d90: 0, d365: 0 };
      // média diária ponderada: prioriza janelas curtas quando há dados
      const diario = c.d90 > 0 ? c.d90 / 90 : c.d30 > 0 ? c.d30 / 30 : c.d365 / 365;
      const mensal = diario * 30;
      const cobertura = diario > 0 ? e.estoque_atual / diario : Infinity;
      const diasSeg = Number(e.dias_seguranca ?? 0);
      const necessidadeLead = diario * lead.dias;
      const estoqueSeg = diario * diasSeg;
      const sugerido = Math.max(0, Math.ceil(necessidadeLead + estoqueSeg - e.estoque_atual));
      let status: "verde" | "amarelo" | "vermelho" = "verde";
      if (cobertura < lead.dias) status = "vermelho";
      else if (cobertura < lead.dias + diasSeg || e.estoque_atual < e.estoque_minimo) status = "amarelo";
      return { epi: e, c, diario, mensal, cobertura, estoqueSeg, sugerido, status };
    });
  }, [epis, consumo, lead.dias]);

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

  function pedidoRows() {
    return filtradas.filter((l) => l.sugerido > 0).map((l) => ({
      "Código do produto": l.epi.codigo_produto ?? "",
      Nome: l.epi.nome,
      Categoria: l.epi.categoria,
      "Estoque atual": l.epi.estoque_atual,
      "Quantidade sugerida": l.sugerido,
      "Data da emissão": new Date().toLocaleString("pt-BR"),
      "Responsável pela emissão": emissor,
    }));
  }

  function gerarExcel() {
    const rows = pedidoRows();
    if (!rows.length) { toast.info("Nenhum item com quantidade sugerida"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]).map((k) => ({ wch: Math.max(14, k.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedido");
    XLSX.writeFile(wb, `pedido_compras_${Date.now()}.xlsx`);
    toast.success("Pedido gerado em Excel");
  }

  function gerarPdf() {
    const rows = pedidoRows();
    if (!rows.length) { toast.info("Nenhum item com quantidade sugerida"); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    const w = doc.internal.pageSize.getWidth();
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("EpiControl GPS", 40, 40);
    doc.setFontSize(11); doc.setFont("helvetica", "normal");
    doc.text("Pedido de Compra do Mês", 40, 58);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, w - 40, 40, { align: "right" });
    doc.text(`Responsável: ${emissor}`, w - 40, 54, { align: "right" });
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 80,
      head: [["Código do produto", "Nome", "Categoria", "Estoque atual", "Quantidade sugerida"]],
      body: rows.map((r) => [r["Código do produto"], r.Nome, r.Categoria, String(r["Estoque atual"]), String(r["Quantidade sugerida"])]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 40, right: 40 },
    });
    doc.save(`pedido_compras_${Date.now()}.pdf`);
    toast.success("Pedido gerado em PDF");
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Planejamento de Compras</h1>
        <p className="text-sm text-muted-foreground">Sugestão automática com base em consumo, lead time e estoque de segurança</p>
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
            <Label>Lead time calculado</Label>
            <div className="h-10 flex items-center rounded-md border px-3 text-sm">
              <b className="mr-1">{lead.dias} dias</b>
              <span className="text-muted-foreground text-xs">
                ({lead.pedido.toLocaleDateString("pt-BR")} → {lead.recebimento.toLocaleDateString("pt-BR")})
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
          <SelectTrigger className="md:w-64"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIAS_EPI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={gerarExcel}><FileSpreadsheet className="h-4 w-4 mr-2" /> Gerar Pedido do Mês (Excel)</Button>
        <Button variant="outline" onClick={gerarPdf}><FileText className="h-4 w-4 mr-2" /> PDF</Button>
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
                <th className="text-right px-3 py-3">Mínimo</th>
                <th className="text-right px-3 py-3">Cons. mensal</th>
                <th className="text-right px-3 py-3">Cons. diário</th>
                <th className="text-right px-3 py-3">Cobertura</th>
                <th className="text-right px-3 py-3">Lead time</th>
                <th className="text-right px-3 py-3">Est. segurança</th>
                <th className="text-right px-3 py-3">Sugerido</th>
                <th className="text-left px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((l) => (
                <tr key={l.epi.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-3 font-mono text-xs">{l.epi.codigo_produto || "—"}</td>
                  <td className="px-3 py-3 font-medium">{l.epi.nome}</td>
                  <td className="px-3 py-3">{l.epi.categoria}</td>
                  <td className="px-3 py-3 text-right">{l.epi.estoque_atual}</td>
                  <td className="px-3 py-3 text-right">{l.epi.estoque_minimo}</td>
                  <td className="px-3 py-3 text-right">{l.mensal.toFixed(1)}</td>
                  <td className="px-3 py-3 text-right">{l.diario.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{Number.isFinite(l.cobertura) ? `${Math.floor(l.cobertura)} d` : "—"}</td>
                  <td className="px-3 py-3 text-right">{lead.dias} d</td>
                  <td className="px-3 py-3 text-right">{Math.ceil(l.estoqueSeg)} <span className="text-xs text-muted-foreground">({l.epi.dias_seguranca}d)</span></td>
                  <td className="px-3 py-3 text-right font-semibold">{l.sugerido}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {l.status === "vermelho" ? "🔴 Compra urgente" : l.status === "amarelo" ? "🟡 Comprar em breve" : "🟢 Não comprar"}
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={12} className="text-center py-12 text-muted-foreground text-sm">Nenhum EPI encontrado.</td></tr>}
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
