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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PackageCheck, AlertTriangle } from "lucide-react";
import { useAuth, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/entregas")({ component: EntregasPage });

type DevTipo = "" | "nenhuma" | "devolucao_normal" | "avariado" | "descarte" | "troca" | "perda" | "roubo";

const DEV_OPTS: { value: Exclude<DevTipo, "">; label: string; desc: string; simples?: boolean }[] = [
  { value: "nenhuma", label: "Primeira entrega", desc: "Não há EPI anterior para devolver" },
  { value: "devolucao_normal", label: "Devolução normal", desc: "EPI anterior volta para o estoque" },
  { value: "avariado", label: "Avariado", desc: "EPI anterior danificado — não retorna ao estoque" },
  { value: "descarte", label: "Descarte", desc: "EPI vencido / fim de vida útil" },
  { value: "troca", label: "Troca", desc: "Substituição por tamanho ou modelo" },
  { value: "perda", label: "Perda", desc: "Apenas informar — não exige EPI anterior", simples: true },
  { value: "roubo", label: "Roubo", desc: "Apenas informar — não exige EPI anterior", simples: true },
];


function EntregasPage() {
  const { role, user } = useAuth();
  const podeEntregar = canMovimentar(role);
  const qc = useQueryClient();

  // Entrega
  const [colaboradorId, setColaboradorId] = useState("");
  const [epiId, setEpiId] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [obs, setObs] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));

  // Devolução integrada
  const [devTipo, setDevTipo] = useState<DevTipo>("");
  const [devEpiId, setDevEpiId] = useState("");
  const [devQtd, setDevQtd] = useState(1);
  const [devMotivo, setDevMotivo] = useState("");

  const [saving, setSaving] = useState(false);

  const { data: colabs = [] } = useQuery({
    queryKey: ["colabs-ativos"],
    queryFn: async () => (await supabase.from("colaboradores").select("id,nome,matricula,setor").eq("status", "ativo").order("nome")).data ?? [],
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

  const DEV_LABEL: Record<string, string> = {
    devolucao_normal: "Devolução normal",
    avariado: "Avariado",
    descarte: "Descarte",
    troca: "Troca",
    perda: "Perda",
    roubo: "Roubo",
  };

  const epiSel = epis.find((e) => e.id === epiId);
  const devEpiSel = epis.find((e) => e.id === devEpiId);
  const opt = DEV_OPTS.find((o) => o.value === devTipo);
  const exigeEpiAnterior = !!opt && opt.value !== "nenhuma" && !opt.simples;
  const exigeApenasMotivo = !!opt?.simples;

  // Validação reativa — usada para desabilitar botão e exibir mensagens inline
  const erros = {
    colaborador: !colaboradorId,
    epi: !epiId,
    quantidade: quantidade < 1,
    estoque: !!epiSel && epiSel.estoque_atual < quantidade,
    devTipo: !devTipo,
    devEpi: exigeEpiAnterior && !devEpiId,
    devEpiIgual: exigeEpiAnterior && !!devEpiId && devEpiId === epiId && devTipo !== "troca",
    devQtd: exigeEpiAnterior && devQtd < 1,
    devMotivoSimples: exigeApenasMotivo && !devMotivo.trim(),
    devMotivoAvariado: devTipo === "avariado" && !devMotivo.trim(),
  };
  const formValido = !Object.values(erros).some(Boolean);

  function resetForm() {
    setColaboradorId(""); setEpiId(""); setQuantidade(1); setObs("");
    setDevTipo(""); setDevEpiId(""); setDevQtd(1); setDevMotivo("");
  }

  async function entregar() {
    if (erros.colaborador || erros.epi || erros.quantidade) { toast.error("Preencha colaborador, EPI e quantidade"); return; }
    if (erros.estoque) { toast.error("Estoque insuficiente"); return; }
    if (erros.devTipo) { toast.error("Selecione o destino do EPI anterior"); return; }
    if (erros.devEpi || erros.devQtd) { toast.error("Informe o EPI anterior e a quantidade da devolução"); return; }
    if (erros.devEpiIgual) { toast.error("O EPI devolvido não pode ser o mesmo que está sendo entregue (exceto em trocas)"); return; }
    if (erros.devMotivoSimples) { toast.error(`Informe o que aconteceu (${opt!.label.toLowerCase()})`); return; }
    if (erros.devMotivoAvariado) { toast.error("Descreva o dano para registrar o EPI avariado"); return; }


    setSaving(true);
    const movData = new Date(data).toISOString();

    // 1) registra devolução PRIMEIRO (se houver) — assim erro no anterior impede a entrega
    if (devTipo && devTipo !== "nenhuma") {
      const { error: devErr } = await supabase.from("movimentacoes").insert({
        tipo: devTipo as any,
        epi_id: exigeEpiAnterior ? devEpiId : epiId, // perda/roubo refere-se ao EPI sendo entregue/substituído
        colaborador_id: colaboradorId,
        quantidade: exigeEpiAnterior ? devQtd : 1,
        motivo: devMotivo || opt!.label,
        observacao: `Registrado junto à entrega de ${epiSel?.nome ?? ""}`,
        usuario_responsavel: user?.id,
        data_movimentacao: movData,
      });
      if (devErr) { setSaving(false); toast.error(`Falha ao registrar devolução: ${devErr.message}`); return; }
    }

    // 2) registra a entrega
    const { error } = await supabase.from("movimentacoes").insert({
      tipo: "entrega", epi_id: epiId, colaborador_id: colaboradorId,
      quantidade, observacao: obs || null,
      usuario_responsavel: user?.id, data_movimentacao: movData,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Entrega registrada!");
    resetForm();
    qc.invalidateQueries();
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Entrega de EPI</h1>
        <p className="text-sm text-muted-foreground">Toda entrega exige informar o destino do EPI anterior</p>
      </div>

      {podeEntregar ? (
        <Card className="p-5 md:p-6 space-y-6">
          {/* SEÇÃO ENTREGA */}
          <div>
            <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">1 · Dados da entrega</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Colaborador *</Label>
                <Select value={colaboradorId} onValueChange={setColaboradorId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{colabs.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} — {c.matricula} ({c.setor})</SelectItem>)}</SelectContent>
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
                <Input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5"><Label>Data</Label>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div className="md:col-span-2 space-y-1.5"><Label>Observação (opcional)</Label>
                <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
            </div>
          </div>

          {/* SEÇÃO DEVOLUÇÃO INTEGRADA */}
          <div className="border-t pt-5">
            <h2 className="font-semibold mb-1 text-sm uppercase tracking-wide text-muted-foreground">2 · EPI anterior do colaborador</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Selecione o que aconteceu com o EPI que estava em uso. Em perda ou roubo basta informar o motivo.
            </p>

            <RadioGroup value={devTipo} onValueChange={(v) => setDevTipo(v as DevTipo)} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {DEV_OPTS.map((o) => (
                <label
                  key={o.value}
                  htmlFor={`dev-${o.value}`}
                  className={`flex gap-2 items-start rounded-md border p-3 cursor-pointer transition-colors ${
                    devTipo === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <RadioGroupItem id={`dev-${o.value}`} value={o.value} className="mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium leading-tight">{o.label}</div>
                    <div className="text-xs text-muted-foreground">{o.desc}</div>
                  </div>
                </label>
              ))}
            </RadioGroup>

            {exigeEpiAnterior && (
              <div className="grid md:grid-cols-3 gap-4 mt-4">
                <div className="md:col-span-2 space-y-1.5"><Label>EPI anterior *</Label>
                  <Select value={devEpiId} onValueChange={setDevEpiId}>
                    <SelectTrigger><SelectValue placeholder="Selecione o EPI devolvido" /></SelectTrigger>
                    <SelectContent>{epis.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome} {e.tamanho ? `(${e.tamanho})` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                  {devEpiSel && <p className="text-xs text-muted-foreground">{devEpiSel.nome}</p>}
                </div>
                <div className="space-y-1.5"><Label>Qtd devolvida *</Label>
                  <Input type="number" min={1} value={devQtd} onChange={(e) => setDevQtd(Number(e.target.value))} />
                </div>
                <div className="md:col-span-3 space-y-1.5"><Label>Motivo / observação</Label>
                  <Textarea rows={2} value={devMotivo} onChange={(e) => setDevMotivo(e.target.value)} placeholder="Ex.: troca de tamanho, vencimento, dano na lente…" />
                </div>
              </div>
            )}

            {exigeApenasMotivo && (
              <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-warning text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" /> {opt.label} — informe o que aconteceu
                </div>
                <Textarea rows={3} value={devMotivo} onChange={(e) => setDevMotivo(e.target.value)} placeholder={`Descreva a circunstância da ${opt.label.toLowerCase()}`} />
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
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
                              {DEV_LABEL[d.tipo] ?? d.tipo}
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
