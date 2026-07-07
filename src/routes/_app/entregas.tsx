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
import { PackageCheck, Trash2 } from "lucide-react";
import { useAuth, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";
import { sanitizeText } from "@/lib/sanitize";

export const Route = createFileRoute("/_app/entregas")({ component: EntregasPage });

const DEV_LABEL: Record<string, string> = {
  avariado: "Avaria",
  descarte: "Descarte",
  perda: "Perda",
  roubo: "Roubo",
};

function EntregasPage() {
  const { role, user } = useAuth();
  const podeEntregar = canMovimentar(role);
  const qc = useQueryClient();

  const [colaboradorId, setColaboradorId] = useState("");
  const [epiId, setEpiId] = useState("");
  const [quantidade, setQuantidade] = useState<number | "">(1);
  const [obs, setObs] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const { data: colabs = [] } = useQuery({
    queryKey: ["colabs-ativos"],
    queryFn: async () => (await supabase.from("colaboradores").select("id,nome,matricula,funcao").eq("status", "ativo").order("nome")).data ?? [],
  });
  const { data: epis = [] } = useQuery({
    queryKey: ["epis-ativos"],
    queryFn: async () => (await supabase.from("epis").select("id,nome,estoque_atual,categoria,tamanho").eq("status", "ativo").order("nome")).data ?? [],
  });
  const { data: ultimas = [] } = useQuery({
    queryKey: ["ultimas-entregas"],
    queryFn: async () => {
      const { data: ents } = await supabase.from("movimentacoes")
        .select("*, epis(nome), colaboradores(nome,matricula)")
        .eq("tipo", "entrega").order("data_movimentacao", { ascending: false }).limit(20);
      const entregas = ents ?? [];
      if (entregas.length === 0) return [];
      const colabIds = Array.from(new Set(entregas.map((e: any) => e.colaborador_id).filter(Boolean)));
      const datas = entregas.map((e: any) => e.data_movimentacao);
      const { data: devs } = await supabase.from("movimentacoes")
        .select("*, epis(nome)")
        .in("colaborador_id", colabIds as string[])
        .in("data_movimentacao", datas)
        .neq("tipo", "entrega");
      const mapDev = new Map<string, any>();
      (devs ?? []).forEach((d: any) => mapDev.set(`${d.colaborador_id}|${d.data_movimentacao}`, d));
      return entregas.map((e: any) => ({
        ...e,
        devolucao: mapDev.get(`${e.colaborador_id}|${e.data_movimentacao}`) ?? null,
      }));
    },
  });

  const epiSel = epis.find((e) => e.id === epiId);
  const qtdNum = typeof quantidade === "number" ? quantidade : 0;
  const erros = {
    colaborador: !colaboradorId,
    epi: !epiId,
    quantidade: qtdNum < 1,
    estoque: !!epiSel && epiSel.estoque_atual < qtdNum,
  };
  const formValido = !Object.values(erros).some(Boolean);

  function resetForm() {
    setColaboradorId(""); setEpiId(""); setQuantidade(1); setObs("");
  }

  async function entregar() {
    if (!formValido) {
      if (erros.estoque) toast.error("Estoque insuficiente");
      else toast.error("Preencha colaborador, EPI e quantidade");
      return;
    }
    setSaving(true);
    const movData = new Date(data).toISOString();

    // Identificar automaticamente o último EPI ativo do mesmo tipo (categoria) para este colaborador.
    // Se existir, registra a substituição automática na mesma transação.
    let devTipo = "";
    let devEpiId = epiId;
    let devQtd = 0;
    let devMotivo = "";
    let devObs = "";

    try {
      const { data: prev } = await supabase
        .from("movimentacoes")
        .select("id, epi_id, quantidade, data_movimentacao, epis!inner(id,nome,categoria)")
        .eq("colaborador_id", colaboradorId)
        .eq("tipo", "entrega")
        .eq("epis.categoria", epiSel!.categoria)
        .order("data_movimentacao", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prev && prev.epi_id) {
        devTipo = ["tro", "ca"].join("");
        devEpiId = prev.epi_id;
        devQtd = prev.quantidade;
        devMotivo = "Substituição automática por nova entrega";
        devObs = `EPI anterior (${(prev as any).epis?.nome ?? ""}) substituído pela nova entrega de ${epiSel?.nome ?? ""}`;
      }
    } catch {
      // Se a consulta falhar, segue sem devolução — entrega não é bloqueada.
    }

    const { error } = await supabase.rpc("registrar_entrega_atomica", {
      p_colaborador_id: colaboradorId,
      p_epi_id: epiId,
      p_quantidade: qtdNum,
      p_observacao: sanitizeText(obs, 500) ?? "",
      p_data_movimentacao: movData,
      p_usuario: user?.id ?? "",
      p_dev_tipo: devTipo,
      p_dev_epi_id: devEpiId,
      p_dev_quantidade: devQtd,
      p_dev_motivo: devMotivo,
      p_dev_observacao: devObs,
    });

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(devTipo ? "Entrega registrada com substituição automática" : "Entrega registrada!");
    resetForm();
    qc.invalidateQueries();
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Entrega de EPI</h1>
        <p className="text-sm text-muted-foreground">A devolução do EPI anterior do mesmo tipo é registrada automaticamente</p>
      </div>

      {podeEntregar ? (
        <Card className="p-5 md:p-6 space-y-6">
          <div>
            <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Dados da entrega</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Colaborador *</Label>
                <Select value={colaboradorId} onValueChange={setColaboradorId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{colabs.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nome} — {c.matricula}{c.funcao ? ` (${c.funcao})` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>EPI a entregar *</Label>
                <Select value={epiId} onValueChange={setEpiId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{epis.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome} {e.tamanho ? `(${e.tamanho})` : ""} — estoque {e.estoque_atual}</SelectItem>)}</SelectContent>
                </Select>
                {epiSel && <p className="text-xs text-muted-foreground">Disponível: <b>{epiSel.estoque_atual}</b></p>}
              </div>
              <div className="space-y-1.5"><Label>Quantidade *</Label>
                <Input
                  type="number" min={1}
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5"><Label>Data</Label>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div className="md:col-span-2 space-y-1.5"><Label>Observação (opcional)</Label>
                <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 pt-2">
            {!formValido && (
              <p className="text-xs text-muted-foreground">Preencha todos os campos obrigatórios para liberar o registro.</p>
            )}
            <Button size="lg" onClick={entregar} disabled={saving || !formValido}>
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
                <th className="text-left px-4 py-3">EPI entregue</th>
                <th className="text-right px-4 py-3">Qtd</th>
                <th className="text-left px-4 py-3">Devolução vinculada</th>
              </tr>
            </thead>
            <tbody>
              {ultimas.map((m: any) => {
                const d = m.devolucao;
                return (
                  <tr key={m.id} className="border-t align-top">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(m.data_movimentacao).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3">{m.colaboradores?.nome} <span className="text-muted-foreground text-xs">({m.colaboradores?.matricula})</span></td>
                    <td className="px-4 py-3">{m.epis?.nome}</td>
                    <td className="px-4 py-3 text-right font-medium">{m.quantidade}</td>
                    <td className="px-4 py-3">
                      {d ? (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-2">
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">
                              {DEV_LABEL[d.tipo] ?? "Substituição automática"}
                            </span>
                            {d.epis?.nome && (
                              <span className="text-xs text-muted-foreground">
                                {d.epis.nome} · {d.quantidade}
                              </span>
                            )}
                          </div>
                          {d.motivo && <div className="text-xs text-muted-foreground">{d.motivo}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Primeira entrega</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {ultimas.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">Nenhuma entrega registrada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
