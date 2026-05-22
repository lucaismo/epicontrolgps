import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PackageCheck } from "lucide-react";
import { useAuth, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/entregas")({ component: EntregasPage });

function EntregasPage() {
  const { role, user } = useAuth();
  const podeEntregar = canMovimentar(role);
  const qc = useQueryClient();

  const [colaboradorId, setColaboradorId] = useState("");
  const [epiId, setEpiId] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [obs, setObs] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const { data: colabs = [] } = useQuery({
    queryKey: ["colabs-ativos"],
    queryFn: async () => {
      const { data } = await supabase.from("colaboradores").select("id,nome,matricula,setor").eq("status", "ativo").order("nome");
      return data ?? [];
    },
  });
  const { data: epis = [] } = useQuery({
    queryKey: ["epis-ativos"],
    queryFn: async () => {
      const { data } = await supabase.from("epis").select("id,nome,estoque_atual,categoria,tamanho").eq("status", "ativo").order("nome");
      return data ?? [];
    },
  });

  const { data: ultimas = [] } = useQuery({
    queryKey: ["ultimas-entregas"],
    queryFn: async () => {
      const { data } = await supabase.from("movimentacoes")
        .select("*, epis(nome), colaboradores(nome,matricula)")
        .eq("tipo", "entrega").order("data_movimentacao", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  const epiSel = epis.find((e) => e.id === epiId);

  async function entregar() {
    if (!colaboradorId || !epiId || quantidade < 1) { toast.error("Preencha colaborador, EPI e quantidade"); return; }
    if (epiSel && epiSel.estoque_atual < quantidade) { toast.error("Estoque insuficiente"); return; }
    setSaving(true);
    const { error } = await supabase.from("movimentacoes").insert({
      tipo: "entrega", epi_id: epiId, colaborador_id: colaboradorId,
      quantidade, observacao: obs || null,
      usuario_responsavel: user?.id, data_movimentacao: new Date(data).toISOString(),
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Entrega registrada!");
      setColaboradorId(""); setEpiId(""); setQuantidade(1); setObs("");
      qc.invalidateQueries();
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Entrega de EPI</h1>
        <p className="text-sm text-muted-foreground">Registre entregas — o estoque é ajustado automaticamente</p>
      </div>

      {podeEntregar ? (
        <Card className="p-5 md:p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Colaborador *</Label>
              <Select value={colaboradorId} onValueChange={setColaboradorId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{colabs.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} — {c.matricula} ({c.setor})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>EPI *</Label>
              <Select value={epiId} onValueChange={setEpiId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{epis.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome} {e.tamanho ? `(${e.tamanho})` : ""} — estoque {e.estoque_atual}</SelectItem>)}</SelectContent>
              </Select>
              {epiSel && <p className="text-xs text-muted-foreground">Estoque disponível: <b>{epiSel.estoque_atual}</b></p>}
            </div>
            <div className="space-y-1.5"><Label>Quantidade *</Label>
              <Input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5"><Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="md:col-span-2 space-y-1.5"><Label>Observação (opcional)</Label>
              <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button size="lg" onClick={entregar} disabled={saving}>
              <PackageCheck className="h-4 w-4 mr-2" /> {saving ? "Registrando…" : "Registrar entrega"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5"><p className="text-sm text-muted-foreground">Seu perfil não permite registrar entregas.</p></Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b"><h2 className="font-semibold">Últimas entregas</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Colaborador</th>
                <th className="text-left px-4 py-3">EPI</th>
                <th className="text-right px-4 py-3">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {ultimas.map((m: any) => (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(m.data_movimentacao).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3">{m.colaboradores?.nome} <span className="text-muted-foreground text-xs">({m.colaboradores?.matricula})</span></td>
                  <td className="px-4 py-3">{m.epis?.nome}</td>
                  <td className="px-4 py-3 text-right font-medium">{m.quantidade}</td>
                </tr>
              ))}
              {ultimas.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-muted-foreground">Nenhuma entrega registrada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
