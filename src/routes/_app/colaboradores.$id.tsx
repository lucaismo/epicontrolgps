import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/colaboradores/$id")({
  component: HistoricoColab,
});

const TIPO_LABEL: Record<string, string> = {
  entrega: "Entrega",
  devolucao_normal: "Devolução",
  avariado: "Avariado",
  descarte: "Descarte",
  troca: "Troca",
  perda: "Perda",
  roubo: "Roubo",
  entrada_estoque: "Entrada estoque",
  ajuste_entrada: "Ajuste (+)",
  ajuste_saida: "Ajuste (−)",
};


function HistoricoColab() {
  const { id } = Route.useParams();

  const { data: colab } = useQuery({
    queryKey: ["colab", id],
    queryFn: async () => {
      const { data } = await supabase.from("colaboradores").select("*").eq("id", id).single();
      return data;
    },
  });

  const { data: movs = [] } = useQuery({
    queryKey: ["colab-movs", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("movimentacoes")
        .select("*, epis(nome,categoria)")
        .eq("colaborador_id", id)
        .order("data_movimentacao", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="p-4 md:p-8 space-y-5">
      <Button asChild variant="ghost" size="sm"><Link to="/colaboradores"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>

      {colab && (
        <Card className="p-6">
          <h1 className="text-2xl font-bold">{colab.nome}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            Matrícula {colab.matricula} · {colab.funcao}{colab.turno ? ` · ${colab.turno}` : ""}
          </div>
          {colab.observacoes && <p className="mt-3 text-sm">{colab.observacoes}</p>}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b"><h2 className="font-semibold">Histórico de movimentações</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">EPI</th>
                <th className="text-right px-4 py-3">Qtd</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Motivo / Obs.</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m: any) => (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(m.data_movimentacao).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3"><span className="text-xs font-medium">{TIPO_LABEL[m.tipo]}</span></td>
                  <td className="px-4 py-3">{m.epis?.nome}</td>
                  <td className="px-4 py-3 text-right font-medium">{m.quantidade}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{m.motivo} {m.observacao ? `· ${m.observacao}` : ""}</td>
                </tr>
              ))}
              {movs.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">Sem movimentações registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
