import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/relatorios")({ component: Relatorios });

function downloadCSV(filename: string, rows: any[]) {
  if (!rows.length) { toast.error("Sem dados para exportar"); return; }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => {
      const v = r[h] ?? "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(",")),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Relatorios() {
  const { data: epis = [] } = useQuery({ queryKey: ["rel-epis"], queryFn: async () => (await supabase.from("epis").select("*").order("nome")).data ?? [] });
  const { data: movs = [] } = useQuery({ queryKey: ["rel-movs"], queryFn: async () => (await supabase.from("movimentacoes").select("*, epis(nome), colaboradores(nome,matricula,funcao)").order("data_movimentacao", { ascending: false }).limit(1000)).data ?? [] });

  async function exportEstoque() {
    downloadCSV("estoque_atual.csv", epis.map((e: any) => ({
      Nome: e.nome, Categoria: e.categoria, CA: e.ca, Modelo: e.modelo, Tamanho: e.tamanho,
      EstoqueAtual: e.estoque_atual, EstoqueMinimo: e.estoque_minimo, Custo: e.custo_unitario,
      Localizacao: e.localizacao, Status: e.status,
    })));
  }
  async function exportMov() {
    downloadCSV("movimentacoes.csv", movs.map((m: any) => ({
      Data: new Date(m.data_movimentacao).toLocaleString("pt-BR"),
      Tipo: m.tipo, EPI: m.epis?.nome, Colaborador: m.colaboradores?.nome,
      Matricula: m.colaboradores?.matricula, Funcao: m.colaboradores?.funcao,
      Quantidade: m.quantidade, Motivo: m.motivo, Observacao: m.observacao,
    })));
  }
  async function exportCriticos() {
    const criticos = (epis as any[]).filter((e) => e.estoque_atual < e.estoque_minimo);
    downloadCSV("epis_criticos.csv", criticos.map((e: any) => ({
      Nome: e.nome, Categoria: e.categoria, EstoqueAtual: e.estoque_atual,
      EstoqueMinimo: e.estoque_minimo, Falta: e.estoque_minimo - e.estoque_atual, Localizacao: e.localizacao,
    })));
  }
  async function imprimir() { window.print(); }

  const reports = [
    { title: "Estoque atual", desc: `${epis.length} EPIs cadastrados`, action: exportEstoque, icon: FileSpreadsheet },
    { title: "Movimentações", desc: `Últimas ${movs.length} movimentações`, action: exportMov, icon: FileSpreadsheet },
    { title: "EPIs críticos", desc: "Itens abaixo do estoque mínimo", action: exportCriticos, icon: FileSpreadsheet },
    { title: "Imprimir / Salvar PDF", desc: "Use 'Salvar como PDF' no diálogo de impressão", action: imprimir, icon: FileText },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Exporte os dados em CSV (compatível com Excel) ou imprima em PDF</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <Card key={r.title} className="p-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-md bg-primary/10 text-primary grid place-items-center"><Icon className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="font-semibold">{r.title}</div>
                  <div className="text-xs text-muted-foreground">{r.desc}</div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={r.action}><Download className="h-4 w-4 mr-2" /> Exportar</Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
