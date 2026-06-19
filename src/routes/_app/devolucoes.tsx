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
import { Undo2 } from "lucide-react";
import { useAuth, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/devolucoes")({ component: DevolucoesPage });

const TIPOS = [
  { value: "perda", label: "Perda" },
  { value: "roubo", label: "Roubo" },
  { value: "avariado", label: "Avariado" },
  { value: "descarte", label: "Descarte" },
];

function DevolucoesPage() {
  const { role, user } = useAuth();
  const pode = canMovimentar(role);
  const qc = useQueryClient();

  const [tipo, setTipo] = useState("perda");
  const [colaboradorId, setColaboradorId] = useState("");
  const [epiId, setEpiId] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: colabs = [] } = useQuery({
    queryKey: ["colabs-ativos"],
    queryFn: async () => (await supabase.from("colaboradores").select("id,nome,matricula").eq("status", "ativo").order("nome")).data ?? [],
  });
  const { data: epis = [] } = useQuery({
    queryKey: ["epis-todos"],
    queryFn: async () => (await supabase.from("epis").select("id,nome,tamanho").order("nome")).data ?? [],
  });

  const { data: ultimas = [] } = useQuery({
    queryKey: ["ultimas-devolucoes"],
    queryFn: async () => (await supabase.from("movimentacoes")
      .select("*, epis(nome), colaboradores(nome)")
      .neq("tipo", "entrega").neq("tipo", "entrada_estoque")
      .order("data_movimentacao", { ascending: false }).limit(20)).data ?? [],
  });

  async function registrar() {
    if (!colaboradorId || !epiId || quantidade < 1) { toast.error("Preencha colaborador, EPI e quantidade"); return; }
    setSaving(true);
    const { error } = await supabase.from("movimentacoes").insert({
      tipo: tipo as any, epi_id: epiId, colaborador_id: colaboradorId,
      quantidade, motivo: motivo || null, observacao: obs || null,
      usuario_responsavel: user?.id,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Devolução registrada"); setColaboradorId(""); setEpiId(""); setQuantidade(1); setMotivo(""); setObs(""); qc.invalidateQueries(); }
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Devolução de EPI</h1>
        <p className="text-sm text-muted-foreground">Registre devoluções, avarias, descartes, trocas e perdas</p>
      </div>

      {pode ? (
        <Card className="p-5 md:p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2 space-y-1.5"><Label>Tipo *</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Colaborador *</Label>
              <Select value={colaboradorId} onValueChange={setColaboradorId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{colabs.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} — {c.matricula}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>EPI *</Label>
              <Select value={epiId} onValueChange={setEpiId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{epis.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome} {e.tamanho ? `(${e.tamanho})` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Quantidade *</Label>
              <Input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5"><Label>Motivo</Label>
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Resumo do motivo" />
            </div>
            <div className="md:col-span-2 space-y-1.5"><Label>Observação</Label>
              <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button size="lg" onClick={registrar} disabled={saving}>
              <Undo2 className="h-4 w-4 mr-2" /> {saving ? "Registrando…" : "Registrar devolução"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5"><p className="text-sm text-muted-foreground">Seu perfil não permite registrar devoluções.</p></Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b"><h2 className="font-semibold">Últimas devoluções</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Colaborador</th>
                <th className="text-left px-4 py-3">EPI</th>
                <th className="text-right px-4 py-3">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {ultimas.map((m: any) => (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(m.data_movimentacao).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 capitalize">{m.tipo.replace("_", " ")}</td>
                  <td className="px-4 py-3">{m.colaboradores?.nome}</td>
                  <td className="px-4 py-3">{m.epis?.nome}</td>
                  <td className="px-4 py-3 text-right font-medium">{m.quantidade}</td>
                </tr>
              ))}
              {ultimas.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">Nenhuma devolução registrada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
