import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { listUsers, createUser, updateUserRole, deleteUser } from "@/lib/admin-users.functions";

export const Route = createFileRoute("/_app/usuarios")({ component: UsuariosPage });

const ROLES_NEW = [
  { value: "admin", label: "Administrador" },
  { value: "tecnico", label: "Técnico de Segurança" },
  { value: "lider", label: "Líder / Visualização" },
];
// Compatibilidade: usuários antigos podem ter o perfil "almoxarife".
const ROLES_ALL = [
  ...ROLES_NEW,
  { value: "almoxarife", label: "Almoxarife (legado)" },
];

function UsuariosPage() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const fetchList = useServerFn(listUsers);
  const callCreate = useServerFn(createUser);
  const callUpdate = useServerFn(updateUserRole);
  const callDelete = useServerFn(deleteUser);

  const isAdmin = role === "admin";

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchList(),
    enabled: isAdmin,
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", password: "", role: "lider" });
  const [saving, setSaving] = useState(false);

  if (!isAdmin) {
    return (
      <div className="p-8">
        <Card className="p-6 text-sm text-muted-foreground">
          Acesso restrito ao administrador.
        </Card>
      </div>
    );
  }

  async function handleCreate() {
    if (!form.nome || !form.email || form.password.length < 8) {
      toast.error("Preencha nome, email e senha (mínimo 8 caracteres)");
      return;
    }
    setSaving(true);
    try {
      await callCreate({ data: form as any });
      toast.success("Usuário criado");
      setForm({ nome: "", email: "", password: "", role: "lider" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  async function handleRole(uid: string, newRole: string) {
    try {
      await callUpdate({ data: { user_id: uid, role: newRole as any } });
      toast.success("Perfil atualizado");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  }

  async function handleDelete(uid: string) {
    if (!confirm("Excluir este usuário? Esta ação não pode ser desfeita.")) return;
    try {
      await callDelete({ data: { user_id: uid } });
      toast.success("Usuário excluído");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Usuários
          </h1>
          <p className="text-sm text-muted-foreground">Apenas o administrador cria contas e define perfis</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Novo usuário</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Criar usuário</DialogTitle></DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-1.5"><Label>Nome completo *</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </div>
              <div className="space-y-1.5"><Label>Email *</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5"><Label>Senha provisória *</Label>
                <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 8 caracteres" />
              </div>
              <div className="space-y-1.5"><Label>Perfil *</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES_NEW.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving}>{saving ? "Criando…" : "Criar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Perfil</th>
                <th className="text-right px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="text-center py-10 text-muted-foreground">Carregando…</td></tr>}
              {!isLoading && users.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-muted-foreground">Nenhum usuário</td></tr>}
              {users.map((u: any) => {
                const current = u.roles[0] ?? "lider";
                const isSelf = u.id === user?.id;
                return (
                  <tr key={u.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{u.nome}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <Select value={current} onValueChange={(v) => handleRole(u.id, v)}>
                        <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(u.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
