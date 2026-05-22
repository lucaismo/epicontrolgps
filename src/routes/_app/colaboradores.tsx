import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Pencil, Trash2, History } from "lucide-react";
import { SETORES, TURNOS } from "@/lib/constants";
import { useAuth, canManageRegistros } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/colaboradores")({
  component: ColaboradoresPage,
});

type Colab = {
  id: string; nome: string; matricula: string; setor: string; funcao: string;
  gestor: string | null; turno: string | null; status: "ativo" | "afastado" | "desligado";
  data_admissao: string | null; observacoes: string | null;
};

function ColaboradoresPage() {
  const { role } = useAuth();
  const canEdit = canManageRegistros(role);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterSetor, setFilterSetor] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [editing, setEditing] = useState<Colab | null>(null);
  const [open, setOpen] = useState(false);

  const { data: list = [] } = useQuery({
    queryKey: ["colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("*").order("nome");
      if (error) throw error;
      return data as Colab[];
    },
  });

  const filtered = list.filter((c) => {
    if (filterSetor !== "all" && c.setor !== filterSetor) return false;
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (search && !`${c.nome} ${c.matricula} ${c.funcao}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleDelete(id: string) {
    if (!confirm("Excluir este colaborador?")) return;
    const { error } = await supabase.from("colaboradores").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); qc.invalidateQueries({ queryKey: ["colaboradores"] }); }
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} de {list.length} colaboradores</p>
        </div>
        {canEdit && (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-2" /> Novo colaborador</Button>
            </DialogTrigger>
            <ColabForm editing={editing} onClose={() => { setOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ["colaboradores"] }); }} />
          </Dialog>
        )}
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, matrícula ou função…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterSetor} onValueChange={setFilterSetor}>
          <SelectTrigger className="md:w-48"><SelectValue placeholder="Setor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos setores</SelectItem>
            {SETORES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="md:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="afastado">Afastado</SelectItem>
            <SelectItem value="desligado">Desligado</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">Matrícula</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Setor</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Função</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{c.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.matricula}</td>
                  <td className="px-4 py-3 hidden md:table-cell">{c.setor}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{c.funcao}</td>
                  <td className="px-4 py-3"><StatusPill status={c.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button asChild variant="ghost" size="icon" title="Histórico">
                        <Link to="/colaboradores/$id" params={{ id: c.id }}><History className="h-4 w-4" /></Link>
                      </Button>
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                          {role === "admin" && (
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">Nenhum colaborador encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ativo: "bg-success/15 text-success",
    afastado: "bg-warning/15 text-warning",
    desligado: "bg-muted text-muted-foreground",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status]}`}>{status}</span>;
}

function ColabForm({ editing, onClose }: { editing: Colab | null; onClose: () => void }) {
  const [form, setForm] = useState<Partial<Colab>>(editing ?? { status: "ativo" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.nome || !form.matricula || !form.setor || !form.funcao) {
      toast.error("Preencha nome, matrícula, setor e função");
      return;
    }
    setSaving(true);
    const payload = {
      nome: form.nome!, matricula: form.matricula!, setor: form.setor!, funcao: form.funcao!,
      gestor: form.gestor || null, turno: form.turno || null,
      status: (form.status as any) ?? "ativo",
      data_admissao: form.data_admissao || null,
      observacoes: form.observacoes || null,
    };
    const { error } = editing
      ? await supabase.from("colaboradores").update(payload).eq("id", editing.id)
      : await supabase.from("colaboradores").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success(editing ? "Atualizado" : "Cadastrado"); onClose(); }
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{editing ? "Editar colaborador" : "Novo colaborador"}</DialogTitle></DialogHeader>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="md:col-span-2 space-y-1.5"><Label>Nome completo *</Label><Input value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Matrícula *</Label><Input value={form.matricula ?? ""} onChange={(e) => setForm({ ...form, matricula: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Setor *</Label>
          <Select value={form.setor ?? ""} onValueChange={(v) => setForm({ ...form, setor: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{SETORES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Função *</Label><Input value={form.funcao ?? ""} onChange={(e) => setForm({ ...form, funcao: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Gestor imediato</Label><Input value={form.gestor ?? ""} onChange={(e) => setForm({ ...form, gestor: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Turno</Label>
          <Select value={form.turno ?? ""} onValueChange={(v) => setForm({ ...form, turno: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{TURNOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Status</Label>
          <Select value={form.status ?? "ativo"} onValueChange={(v) => setForm({ ...form, status: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="afastado">Afastado</SelectItem>
              <SelectItem value="desligado">Desligado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Data de admissão</Label><Input type="date" value={form.data_admissao ?? ""} onChange={(e) => setForm({ ...form, data_admissao: e.target.value })} /></div>
        <div className="md:col-span-2 space-y-1.5"><Label>Observações</Label><Textarea rows={3} value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
