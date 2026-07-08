import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_app/relatorios")({ component: Relatorios });

const APP_NAME = "EpiControl GPS";

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString("pt-BR");
}

function autoWidths(rows: Record<string, any>[]) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((k) => {
    const max = Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length));
    return { wch: Math.min(Math.max(max + 2, 10), 45) };
  });
}

function buildSheet(title: string, rows: Record<string, any>[]) {
  const ws = XLSX.utils.json_to_sheet([]);
  XLSX.utils.sheet_add_aoa(ws, [[title], [`Emitido em: ${new Date().toLocaleString("pt-BR")}`], []], { origin: "A1" });
  if (rows.length) {
    XLSX.utils.sheet_add_json(ws, rows, { origin: "A4" });
    ws["!cols"] = autoWidths(rows);
  } else {
    XLSX.utils.sheet_add_aoa(ws, [["Sem dados"]], { origin: "A4" });
  }
  return ws;
}

function pdfHeader(doc: jsPDF, title: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(APP_NAME, 40, 40);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(title, 40, 58);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, pageWidth - 40, 40, { align: "right" });
  doc.setTextColor(0);
  doc.setDrawColor(200);
  doc.line(40, 68, pageWidth - 40, 68);
}

function pdfFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`${APP_NAME} · Gestão de EPIs`, 40, pageHeight - 20);
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - 40, pageHeight - 20, { align: "right" });
  }
}

function pdfTable(doc: jsPDF, title: string, rows: Record<string, any>[], startY = 88) {
  if (!rows.length) {
    doc.setFontSize(10);
    doc.text(`${title}: sem dados`, 40, startY);
    return startY + 20;
  }
  const head = [Object.keys(rows[0])];
  const body = rows.map((r) => head[0].map((k) => String(r[k] ?? "")));
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(title, 40, startY);
  autoTable(doc, {
    startY: startY + 8,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 40, right: 40, bottom: 40 },
  });
  return (doc as any).lastAutoTable.finalY + 20;
}

function Relatorios() {
  const { data: epis = [] } = useQuery({ queryKey: ["rel-epis"], queryFn: async () => (await supabase.from("epis").select("*").order("nome")).data ?? [] });
  const { data: movs = [] } = useQuery({ queryKey: ["rel-movs"], queryFn: async () => {
    const { data: ms } = await supabase.from("movimentacoes").select("*, epis(nome,categoria,custo_unitario), colaboradores(nome,matricula,funcao)").order("data_movimentacao", { ascending: false }).limit(2000);
    const rows = ms ?? [];
    const userIds = Array.from(new Set(rows.map((r: any) => r.usuario_responsavel).filter(Boolean)));
    let profMap = new Map<string, any>();
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id,nome,email").in("id", userIds as string[]);
      (profs ?? []).forEach((p: any) => profMap.set(p.id, p));
    }
    return rows.map((r: any) => ({ ...r, responsavel: r.usuario_responsavel ? profMap.get(r.usuario_responsavel) ?? null : null }));
  } });
  const { data: colabs = [] } = useQuery({ queryKey: ["rel-colabs"], queryFn: async () => (await supabase.from("colaboradores").select("*").order("nome")).data ?? [] });

  function rowsEstoque() {
    return (epis as any[]).map((e) => ({
      Nome: e.nome, Categoria: e.categoria, CA: e.ca ?? "", Modelo: e.modelo ?? "", Tamanho: e.tamanho ?? "",
      "Estoque atual": e.estoque_atual, "Estoque mínimo": e.estoque_minimo,
      "Custo unitário (R$)": Number(e.custo_unitario ?? 0).toFixed(2),
      "Valor total (R$)": (Number(e.custo_unitario ?? 0) * e.estoque_atual).toFixed(2),
      Localização: e.localizacao ?? "", Status: e.status,
    }));
  }
  function rowsCriticos() {
    return (epis as any[]).filter((e) => e.estoque_atual < e.estoque_minimo).map((e) => ({
      Nome: e.nome, Categoria: e.categoria, "Estoque atual": e.estoque_atual,
      "Estoque mínimo": e.estoque_minimo, Falta: e.estoque_minimo - e.estoque_atual, Localização: e.localizacao ?? "",
    }));
  }
  function rowsMovs() {
    return (movs as any[]).map((m) => ({
      Data: fmtDate(m.data_movimentacao), Tipo: m.tipo,
      EPI: m.epis?.nome ?? "", Categoria: m.epis?.categoria ?? "",
      Colaborador: m.colaboradores?.nome ?? "", Matrícula: m.colaboradores?.matricula ?? "",
      Função: m.colaboradores?.funcao ?? "", Quantidade: m.quantidade,
      Motivo: m.motivo ?? "", Observação: m.observacao ?? "",
    }));
  }
  function rowsColabs() {
    return (colabs as any[]).map((c) => ({
      Matrícula: c.matricula, Nome: c.nome, Função: c.funcao,
      Turno: c.turno ?? "", Status: c.status,
      "Admissão": c.data_admissao ? new Date(c.data_admissao).toLocaleDateString("pt-BR") : "",
    }));
  }

  // -------- Excel exports --------
  function xlsxEstoque() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet("Estoque atual de EPIs", rowsEstoque()), "Estoque");
    XLSX.utils.book_append_sheet(wb, buildSheet("EPIs em estado crítico", rowsCriticos()), "Críticos");
    XLSX.writeFile(wb, `estoque_${Date.now()}.xlsx`);
  }
  function xlsxMovs() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet("Movimentações", rowsMovs()), "Movimentações");
    XLSX.writeFile(wb, `movimentacoes_${Date.now()}.xlsx`);
  }
  function xlsxColabs() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet("Colaboradores", rowsColabs()), "Colaboradores");
    XLSX.writeFile(wb, `colaboradores_${Date.now()}.xlsx`);
  }
  function xlsxGeral() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet("Estoque atual", rowsEstoque()), "Estoque");
    XLSX.utils.book_append_sheet(wb, buildSheet("EPIs críticos", rowsCriticos()), "Críticos");
    XLSX.utils.book_append_sheet(wb, buildSheet("Movimentações", rowsMovs()), "Movimentações");
    XLSX.utils.book_append_sheet(wb, buildSheet("Colaboradores", rowsColabs()), "Colaboradores");
    XLSX.writeFile(wb, `relatorio_geral_${Date.now()}.xlsx`);
  }

  // -------- PDF exports --------
  function pdfEstoque() {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    pdfHeader(doc, "Relatório de Estoque");
    pdfTable(doc, "Estoque atual", rowsEstoque());
    pdfFooter(doc);
    doc.save(`estoque_${Date.now()}.pdf`);
  }
  function pdfMovs() {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    pdfHeader(doc, "Relatório de Movimentações");
    pdfTable(doc, "Movimentações", rowsMovs());
    pdfFooter(doc);
    doc.save(`movimentacoes_${Date.now()}.pdf`);
  }
  function pdfCriticos() {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt" });
    pdfHeader(doc, "EPIs em estado crítico");
    pdfTable(doc, "Itens abaixo do estoque mínimo", rowsCriticos());
    pdfFooter(doc);
    doc.save(`criticos_${Date.now()}.pdf`);
  }
  function pdfGeral() {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    pdfHeader(doc, "Relatório Geral");
    let y = 88;
    y = pdfTable(doc, "1. Estoque atual", rowsEstoque(), y);
    doc.addPage(); pdfHeader(doc, "Relatório Geral");
    y = pdfTable(doc, "2. EPIs críticos", rowsCriticos(), 88);
    doc.addPage(); pdfHeader(doc, "Relatório Geral");
    y = pdfTable(doc, "3. Movimentações", rowsMovs(), 88);
    doc.addPage(); pdfHeader(doc, "Relatório Geral");
    y = pdfTable(doc, "4. Colaboradores", rowsColabs(), 88);
    pdfFooter(doc);
    doc.save(`relatorio_geral_${Date.now()}.pdf`);
  }

  const reports = [
    { title: "Estoque atual", desc: `${epis.length} EPIs cadastrados`, xlsx: xlsxEstoque, pdf: pdfEstoque },
    { title: "Movimentações", desc: `${movs.length} movimentações`, xlsx: xlsxMovs, pdf: pdfMovs },
    { title: "EPIs críticos", desc: "Itens abaixo do estoque mínimo", xlsx: () => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, buildSheet("EPIs críticos", rowsCriticos()), "Críticos"); XLSX.writeFile(wb, `criticos_${Date.now()}.xlsx`); toast.success("Exportado"); }, pdf: pdfCriticos },
    { title: "Colaboradores", desc: `${colabs.length} cadastrados`, xlsx: xlsxColabs, pdf: () => { const doc = new jsPDF({ unit: "pt" }); pdfHeader(doc, "Colaboradores"); pdfTable(doc, "Colaboradores", rowsColabs()); pdfFooter(doc); doc.save(`colaboradores_${Date.now()}.pdf`); } },
    { title: "Relatório geral (todas as seções)", desc: "Estoque + Críticos + Movimentações + Colaboradores", xlsx: xlsxGeral, pdf: pdfGeral },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Exporte em Excel (planilhas formatadas) ou PDF (paginação, cabeçalho e rodapé)</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {reports.map((r) => (
          <Card key={r.title} className="p-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary grid place-items-center"><FileSpreadsheet className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="font-semibold">{r.title}</div>
                <div className="text-xs text-muted-foreground">{r.desc}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={r.xlsx}><FileSpreadsheet className="h-4 w-4 mr-2" /> Excel</Button>
              <Button variant="outline" size="sm" onClick={r.pdf}><FileText className="h-4 w-4 mr-2" /> PDF</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
