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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PackageCheck, Trash2, Pencil, Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";
import { sanitizeText } from "@/lib/sanitize";

export const Route = createFileRoute("/_app/entregas")({ component: EntregasPage });

const PAGE_SIZE = 25;
const MAX_ITENS = 5;

type Item = { epiId: string; quantidade: number | "" };

function EntregasPage() {
  const { role, user } = useAuth();
  const podeEntregar = canMovimentar(role);
  const qc = useQueryClient();

  const [colaboradorId, setColaboradorId] = useState("");
  const [itens, setItens] = useState<Item[]>([{ epiId: "", quantidade: 1 }]);
  const [obs, setObs] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<any | null>(null);

  const { data: colabs = [] } = useQuery({
    queryKey: ["colabs-ativos"],
    queryFn: async () => (await supabase.from("colaboradores").select("id,nome,matricula,funcao,turno").eq("status", "ativo").order("nome")).data ?? [],
  });
  const { data: epis = [] } = useQuery({
    queryKey: ["epis-ativos"],
    queryFn: async () => (await supabase.from("epis").select("id,nome,codigo_produto,estoque_atual,categoria,tamanho").eq("status", "ativo").order("nome")).data ?? [],
  });
  const { data: entregasPage } = useQuery({
    queryKey: ["ultimas-entregas", page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data: ents, count } = await supabase.from("movimentacoes")
        .select("*, epis(nome,codigo_produto), colaboradores(nome,matricula,turno)", { count: "exact" })
        .eq("tipo", "entrega")
        .order("data_movimentacao", { ascending: false })
        .range(from, to);
      const entregas = ents ?? [];
      if (entregas.length === 0) return { rows: [], total: count ?? 0 };
      const userIds = Array.from(new Set(entregas.map((e: any) => e.usuario_responsavel).filter(Boolean)));
      const profsRes = userIds.length
        ? await supabase.rpc("nomes_responsaveis", { p_ids: userIds as string[] })
        : { data: [] as any[] };
      const mapProf = new Map<string, any>();
      (profsRes.data ?? []).forEach((p: any) => mapProf.set(p.id, p));
      return {
        rows: entregas.map((e: any) => ({
          ...e,
          responsavel: e.usuario_responsavel ? mapProf.get(e.usuario_responsavel) ?? null : null,
        })),
        total: count ?? entregas.length,
      };
    },
  });
  const ultimas = entregasPage?.rows ?? [];
  const total = entregasPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const itensValidos = itens.filter((i) => i.epiId && typeof i.quantidade === "number" && i.quantidade >= 1);
  const semEstoque = itens.some((i) => {
    const e = epis.find((x: any) => x.id === i.epiId);
    return !!e && typeof i.quantidade === "number" && e.estoque_atual < i.quantidade;
  });
  const duplicado = new Set(itensValidos.map((i) => i.epiId)).size !== itensValidos.length;
  const formValido = !!colaboradorId && itensValidos.length === itens.length && itens.length > 0 && !semEstoque && !duplicado;

  function resetForm() {
    setColaboradorId(""); setItens([{ epiId: "", quantidade: 1 }]); setObs("");
  }

  async function excluirEntrega(movId: string) {
    if (!confirm("Excluir esta entrega? O estoque será restaurado automaticamente.")) return;
    const { error } = await supabase.rpc("excluir_entrega", { p_mov_id: movId, p_usuario: user?.id ?? "" });
    if (error) toast.error(error.message);
    else { toast.success("Entrega excluída e estoque restaurado"); await qc.invalidateQueries(); }
  }

  async function entregar() {
    if (!formValido) {
      if (semEstoque) toast.error("Estoque insuficiente em um dos itens");
      else if (duplicado) toast.error("Não repita o mesmo EPI na mesma operação");
      else toast.error("Preencha colaborador, EPIs e quantidades");
      return;
    }
    setSaving(true);
    const [yy, mm, dd] = data.split("-").map(Number);
    const now = new Date();
    const movData = new Date(yy, mm - 1, dd, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();

    const { error } = await supabase.rpc("registrar_entrega_multipla", {
      p_colaborador_id: colaboradorId,
      p_itens: itensValidos.map((i) => ({ epi_id: i.epiId, quantidade: i.quantidade })) as any,
      p_observacao: sanitizeText(obs, 500) ?? "",
      p_data_movimentacao: movData,
      p_usuario: user?.id ?? "",
    });

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${itensValidos.length} entrega(s) registrada(s) — trocas do EPI anterior aplicadas automaticamente`);
    resetForm();
    setPage(0);
    await qc.invalidateQueries();
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Entrega de EPI</h1>
        <p className="text-sm text-muted-foreground">Até {MAX_ITENS} EPIs por operação · a troca do EPI anterior da mesma categoria é registrada automaticamente</p>
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
              <div className="space-y-1.5"><Label>Data</Label>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">EPIs a entregar ({itens.length}/{MAX_ITENS})</h2>
            {itens.map((it, idx) => {
              const sel = epis.find((e: any) => e.id === it.epiId);
              return (
                <div key={idx} className="grid md:grid-cols-[1fr_140px_44px] gap-2 items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">EPI {idx + 1} *</Label>
                    <Select value={it.epiId} onValueChange={(v) => setItens(itens.map((x, i) => i === idx ? { ...x, epiId: v } : x))}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {epis.map((e: any) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.codigo_produto ? `[${e.codigo_produto}] ` : ""}{e.nome} {e.tamanho ? `(${e.tamanho})` : ""} — estoque {e.estoque_atual}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {sel && typeof it.quantidade === "number" && sel.estoque_atual < it.quantidade && (
                      <p className="text-xs text-destructive">Estoque insuficiente (disponível {sel.estoque_atual})</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Quantidade *</Label>
                    <Input type="number" min={1} value={it.quantidade}
                      onChange={(e) => setItens(itens.map((x, i) => i === idx ? { ...x, quantidade: e.target.value === "" ? "" : Number(e.target.value) } : x))} />
                  </div>
                  <Button variant="ghost" size="icon" disabled={itens.length === 1}
                    onClick={() => setItens(itens.filter((_, i) => i !== idx))} title="Remover item">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            {itens.length < MAX_ITENS && (
              <Button variant="outline" size="sm" onClick={() => setItens([...itens, { epiId: "", quantidade: 1 }])}>
                <Plus className="h-4 w-4 mr-2" /> Adicionar EPI
              </Button>
            )}
            {duplicado && <p className="text-xs text-destructive">Há EPIs repetidos na operação.</p>}
          </div>

          <div className="space-y-1.5"><Label>Observação (opcional)</Label>
            <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
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
        <div className="p-4 border-b"><h2 className="font-semibold">Histórico de entregas</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Data / hora</th>
                <th className="text-left px-4 py-3">Colaborador</th>
                <th className="text-left px-4 py-3">Código</th>
                <th className="text-left px-4 py-3">EPI entregue</th>
                <th className="text-right px-4 py-3">Qtd</th>
                <th className="text-left px-4 py-3">Turno</th>
                <th className="text-left px-4 py-3">Responsável</th>
                {role === "admin" && <th className="text-right px-4 py-3">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {ultimas.map((m: any) => {
                const resp = m.responsavel;
                return (
                  <tr key={m.id} className="border-t align-top">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(m.data_movimentacao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                    <td className="px-4 py-3">{m.colaboradores?.nome} <span className="text-muted-foreground text-xs">({m.colaboradores?.matricula})</span></td>
                    <td className="px-4 py-3 font-mono text-xs">{m.epis?.codigo_produto || "—"}</td>
                    <td className="px-4 py-3">{m.epis?.nome}</td>
                    <td className="px-4 py-3 text-right font-medium">{m.quantidade}</td>
                    <td className="px-4 py-3">
                      {m.colaboradores?.turno ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">{m.colaboradores.turno}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {resp ? <span title={resp.email ?? ""}>{resp.nome}</span> : <span className="text-xs text-muted-foreground italic">—</span>}
                    </td>
                    {role === "admin" && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" title="Editar entrega" onClick={() => setEditing(m)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Excluir entrega" onClick={() => excluirEntrega(m.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {ultimas.length === 0 && <tr><td colSpan={role === "admin" ? 8 : 7} className="text-center py-10 text-muted-foreground">Nenhuma entrega registrada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-muted-foreground">
              Página {page + 1} de {totalPages} · {total} entregas
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                Próxima <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <EditarEntregaDialog
        entrega={editing}
        epis={epis as any[]}
        onClose={async (changed) => { setEditing(null); if (changed) await qc.invalidateQueries(); }}
      />
    </div>
  );
}

function EditarEntregaDialog({ entrega, epis, onClose }: { entrega: any | null; epis: any[]; onClose: (changed: boolean) => void }) {
  const [epiId, setEpiId] = useState("");
  const [qtd, setQtd] = useState<number | "">(1);
  const [dataHora, setDataHora] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (entrega && loadedFor !== entrega.id) {
    setLoadedFor(entrega.id);
    setEpiId(entrega.epi_id);
    setQtd(entrega.quantidade);
    const d = new Date(entrega.data_movimentacao);
    const pad = (n: number) => String(n).padStart(2, "0");
    setDataHora(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setObs(entrega.observacao ?? "");
  }

  async function salvar() {
    if (!entrega) return;
    if (!epiId || typeof qtd !== "number" || qtd < 1) { toast.error("Informe EPI e quantidade válida"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("editar_entrega", {
      p_mov_id: entrega.id,
      p_epi_id: epiId,
      p_quantidade: qtd,
      p_data_movimentacao: dataHora ? new Date(dataHora).toISOString() : entrega.data_movimentacao,
      p_observacao: sanitizeText(obs, 500) ?? "",
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Entrega atualizada e estoque ajustado");
    onClose(true);
  }

  return (
    <Dialog open={!!entrega} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar entrega</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Colaborador: <b>{entrega?.colaboradores?.nome}</b> ({entrega?.colaboradores?.matricula})
          </div>
          <div className="space-y-1.5"><Label>EPI</Label>
            <Select value={epiId} onValueChange={setEpiId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {epis.map((e) => <SelectItem key={e.id} value={e.id}>{e.codigo_produto ? `[${e.codigo_produto}] ` : ""}{e.nome} — estoque {e.estoque_atual}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Quantidade</Label>
            <Input type="number" min={1} value={qtd} onChange={(e) => setQtd(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div className="space-y-1.5"><Label>Data e hora</Label>
            <Input type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
          </div>
          <div className="space-y-1.5"><Label>Observação</Label>
            <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
          <p className="text-[11px] text-muted-foreground">O estoque é recalculado automaticamente e a alteração fica registrada na auditoria.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
