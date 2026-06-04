import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, PackagePlus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

import { CATEGORIAS_EPI } from "@/lib/constants";
import { useAuth, canManageRegistros, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";
import { StockBadge } from "./dashboard";

export const Route = createFileRoute("/_app/epis")({ component: EpisPage });

type Epi = {
  id: string; nome: string; categoria: string; ca: string | null; modelo: string | null;
  tamanho: string | null; estoque_atual: number; estoque_minimo: number;
  custo_unitario: number; localizacao: string | null; status: "ativo" | "inativo";
};

function EpisPage() {
  const { role, user } = useAuth();
  const canEdit = canManageRegistros(role);
  const canEditStock = canMovimentar(role);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Epi | null>(null);
  const [entradaFor, setEntradaFor] = useState<Epi | null>(null);


  const { data: list = [] } = useQuery({
    queryKey: ["epis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("epis").select("*").order("nome");
      if (error) throw error;
      return data as Epi[];
    },
  });

  const filtered = list.filter((e) => {
    if (filterCat !== "all" && e.categoria !== filterCat) return false;
    if (search && !`${e.nome} ${e.ca} ${e.modelo}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleDelete(id: string) {
    if (!confirm("Excluir este EPI?")) return;
    const { error } = await supabase.from("epis").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); qc.invalidateQueries({ queryKey: ["epis"] }); }
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">EPIs</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} de {list.length} itens</p>
        </div>
        {(canEdit || canEditStock) && (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild><Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-2" /> Novo EPI</Button></DialogTrigger>
            <EpiForm editing={editing} onClose={() => { setOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ["epis"] }); }} />
          </Dialog>
        )}
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, CA ou modelo…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="md:w-64"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIAS_EPI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      <div className="grid md:hidden gap-3">
        {filtered.map((e) => (
          <Card key={e.id} className="p-4">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{e.nome}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{e.categoria} · CA {e.ca || "—"} · {e.tamanho || "—"}</div>
                <div className="text-xs text-muted-foreground">📍 {e.localizacao || "—"}</div>
              </div>
              <StockBadge atual={e.estoque_atual} minimo={e.estoque_minimo} />
            </div>
            {(canEdit || canEditStock) && (
              <div className="flex justify-end gap-1 mt-3 pt-3 border-t">
                {canEditStock && <Button variant="ghost" size="sm" onClick={() => setEntradaFor(e)}><PackagePlus className="h-4 w-4 mr-1" /> Entrada</Button>}
                <Button variant="ghost" size="sm" onClick={() => { setEditing(e); setOpen(true); }}><Pencil className="h-4 w-4 mr-1" /> Editar</Button>
                {role === "admin" && <Button variant="ghost" size="sm" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
              </div>
            )}

          </Card>
        ))}
      </div>

      <Card className="overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">EPI</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-left px-4 py-3">CA</th>
                <th className="text-left px-4 py-3">Tamanho</th>
                <th className="text-right px-4 py-3">Custo</th>
                <th className="text-left px-4 py-3">Estoque</th>
                <th className="text-right px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3"><div className="font-medium">{e.nome}</div><div className="text-xs text-muted-foreground">{e.modelo}</div></td>
                  <td className="px-4 py-3">{e.categoria}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.ca || "—"}</td>
                  <td className="px-4 py-3">{e.tamanho || "—"}</td>
                  <td className="px-4 py-3 text-right">R$ {Number(e.custo_unitario).toFixed(2)}</td>
                  <td className="px-4 py-3"><StockBadge atual={e.estoque_atual} minimo={e.estoque_minimo} /></td>
                  <td className="px-4 py-3 text-right">
                    {(canEdit || canEditStock) && (
                      <div className="inline-flex gap-1">
                        {canEditStock && <Button variant="ghost" size="icon" title="Entrada de estoque" onClick={() => setEntradaFor(e)}><PackagePlus className="h-4 w-4" /></Button>}
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => { setEditing(e); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        {role === "admin" && <Button variant="ghost" size="icon" title="Excluir" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">Nenhum EPI encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <EntradaEstoqueDialog
        epi={entradaFor}
        userId={user?.id ?? ""}
        onClose={() => { setEntradaFor(null); qc.invalidateQueries({ queryKey: ["epis"] }); }}
      />
    </div>
  );
}

function EntradaEstoqueDialog({ epi, userId, onClose }: { epi: Epi | null; userId: string; onClose: () => void }) {
  const [qtd, setQtd] = useState(1);
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  async function salvar() {
    if (!epi) return;
    if (qtd < 1) { toast.error("Quantidade deve ser maior que zero"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("registrar_entrada_estoque", {
      p_epi_id: epi.id,
      p_quantidade: qtd,
      p_motivo: motivo || "Entrada de estoque",
      p_observacao: obs || "",
      p_usuario: userId,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`+${qtd} ${epi.nome} no estoque`);
    setQtd(1); setMotivo(""); setObs("");
    onClose();
  }

  return (
    <Dialog open={!!epi} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Entrada de estoque · {epi?.nome}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Estoque atual: <b>{epi?.estoque_atual ?? 0}</b> · ficará <b>{(epi?.estoque_atual ?? 0) + qtd}</b>
          </div>
          <div className="space-y-1.5"><Label>Quantidade *</Label>
            <Input type="number" min={1} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5"><Label>Motivo / Nota Fiscal</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: NF 12345 — Fornecedor X" />
          </div>
          <div className="space-y-1.5"><Label>Observação</Label>
            <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Registrando…" : "Registrar entrada"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function EpiForm({ editing, onClose }: { editing: Epi | null; onClose: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState<Partial<Epi>>(editing ?? { status: "ativo", estoque_atual: 0, estoque_minimo: 0, custo_unitario: 0 });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.nome || !form.categoria) { toast.error("Nome e categoria são obrigatórios"); return; }
    setSaving(true);
    // A1: ao editar NÃO permite alterar estoque_atual — use "Entrada de estoque" ou inventário.
    const basePayload = {
      nome: form.nome!, categoria: form.categoria!, ca: form.ca || null, modelo: form.modelo || null,
      tamanho: form.tamanho || null,
      estoque_minimo: Number(form.estoque_minimo ?? 0), custo_unitario: Number(form.custo_unitario ?? 0),
      localizacao: form.localizacao || null, status: (form.status as any) ?? "ativo",
    };

    let error: any = null;
    if (editing) {
      const r = await supabase.from("epis").update(basePayload).eq("id", editing.id);
      error = r.error;
    } else {
      // A4: cria o EPI com estoque zero e registra entrada rastreável se houver estoque inicial
      const r = await supabase.from("epis").insert({ ...basePayload, estoque_atual: 0 }).select("id").single();
      error = r.error;
      const qtdInicial = Number(form.estoque_atual ?? 0);
      if (!error && r.data?.id && qtdInicial > 0) {
        const rpc = await supabase.rpc("registrar_entrada_estoque", {
          p_epi_id: r.data.id, p_quantidade: qtdInicial,
          p_motivo: "Estoque inicial no cadastro",
          p_observacao: "", p_usuario: user?.id ?? "",
        });
        if (rpc.error) error = rpc.error;
      }
    }
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success(editing ? "Atualizado" : "Cadastrado"); onClose(); }
  }


  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{editing ? "Editar EPI" : "Novo EPI"}</DialogTitle></DialogHeader>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="md:col-span-2 space-y-1.5"><Label>Nome *</Label><Input value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Categoria *</Label>
          <Select value={form.categoria ?? ""} onValueChange={(v) => setForm({ ...form, categoria: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{CATEGORIAS_EPI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>CA</Label><Input value={form.ca ?? ""} onChange={(e) => setForm({ ...form, ca: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Modelo</Label><Input value={form.modelo ?? ""} onChange={(e) => setForm({ ...form, modelo: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Tamanho</Label><Input value={form.tamanho ?? ""} onChange={(e) => setForm({ ...form, tamanho: e.target.value })} /></div>
        <div className="space-y-1.5">
          <Label>{editing ? "Estoque atual (somente leitura)" : "Estoque inicial"}</Label>
          <Input
            type="number" min={0}
            value={form.estoque_atual ?? 0}
            disabled={!!editing}
            onChange={(e) => setForm({ ...form, estoque_atual: Number(e.target.value) })}
          />
          {editing
            ? <p className="text-[11px] text-muted-foreground">Use “Entrada de estoque” ou inventário para alterar.</p>
            : <p className="text-[11px] text-muted-foreground">Registrado como entrada rastreável.</p>}
        </div>

        <div className="space-y-1.5"><Label>Estoque mínimo</Label><Input type="number" min={0} value={form.estoque_minimo ?? 0} onChange={(e) => setForm({ ...form, estoque_minimo: Number(e.target.value) })} /></div>
        <div className="space-y-1.5"><Label>Custo unitário (R$)</Label><Input type="number" step="0.01" min={0} value={form.custo_unitario ?? 0} onChange={(e) => setForm({ ...form, custo_unitario: Number(e.target.value) })} /></div>
        <div className="space-y-1.5"><Label>Localização física</Label><Input value={form.localizacao ?? ""} onChange={(e) => setForm({ ...form, localizacao: e.target.value })} placeholder="Ex: Prateleira A-3" /></div>
        <div className="space-y-1.5 md:col-span-2"><Label>Status</Label>
          <Select value={form.status ?? "ativo"} onValueChange={(v) => setForm({ ...form, status: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ativo">Ativo</SelectItem><SelectItem value="inativo">Inativo</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
