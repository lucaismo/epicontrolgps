import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Pencil, UserX, UserCheck, History, Upload, Download } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { TURNOS, STATUS_COLAB, type Turno, type StatusColab } from "@/lib/constants";
import { useAuth, canManageRegistros } from "@/lib/auth";
import { toast } from "sonner";
import { sanitizeText } from "@/lib/sanitize";

export const Route = createFileRoute("/_app/colaboradores")({
  component: ColaboradoresPage,
});

type Colab = {
  id: string; nome: string; matricula: string; funcao: string;
  turno: string | null; status: StatusColab;
  data_admissao: string | null; observacoes: string | null;
};

function ColaboradoresPage() {
  const { role } = useAuth();
  const canEdit = canManageRegistros(role);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterTurno, setFilterTurno] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [editing, setEditing] = useState<Colab | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: list = [] } = useQuery({
    queryKey: ["colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("colaboradores")
        .select("id,nome,matricula,funcao,turno,status,data_admissao,observacoes")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Colab[];
    },
  });

  const filtered = list.filter((c) => {
    if (filterTurno !== "all" && c.turno !== filterTurno) return false;
    if (filterStatus === "ativos" && c.status !== "ativo") return false;
    else if (filterStatus === "inativos" && c.status === "ativo") return false;
    else if (filterStatus !== "all" && filterStatus !== "ativos" && filterStatus !== "inativos" && c.status !== filterStatus) return false;
    if (search && !`${c.nome} ${c.matricula} ${c.funcao}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleInativar(c: Colab) {
    if (!confirm(`Inativar o colaborador "${c.nome}"? O histórico de movimentações será preservado.`)) return;
    const { error } = await supabase.from("colaboradores").update({ status: "desligado" }).eq("id", c.id);
    if (error) toast.error(error.message); else { toast.success("Colaborador inativado"); qc.invalidateQueries({ queryKey: ["colaboradores"] }); }
  }

  async function handleReativar(c: Colab) {
    const { error } = await supabase.from("colaboradores").update({ status: "ativo" }).eq("id", c.id);
    if (error) toast.error(error.message); else { toast.success("Colaborador reativado"); qc.invalidateQueries({ queryKey: ["colaboradores"] }); }
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} de {list.length} colaboradores</p>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline"><Upload className="h-4 w-4 mr-2" /> Importar Excel</Button>
              </DialogTrigger>
              <ImportDialog onClose={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ["colaboradores"] }); }} existing={list} />
            </Dialog>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-2" /> Novo colaborador</Button>
              </DialogTrigger>
              <ColabForm editing={editing} onClose={() => { setOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ["colaboradores"] }); }} />
            </Dialog>
          </div>
        )}
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, matrícula ou função…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterTurno} onValueChange={setFilterTurno}>
          <SelectTrigger className="md:w-48"><SelectValue placeholder="Turno" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos turnos</SelectItem>
            {TURNOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
                <th className="text-left px-4 py-3 hidden md:table-cell">Função</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Turno</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{c.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.matricula}</td>
                  <td className="px-4 py-3 hidden md:table-cell">{c.funcao}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{c.turno ?? "—"}</td>
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
    if (!form.nome || !form.matricula || !form.funcao) {
      toast.error("Preencha nome, matrícula e função");
      return;
    }
    setSaving(true);
    const payload = {
      nome: sanitizeText(form.nome, 120)!,
      matricula: sanitizeText(form.matricula, 60)!,
      funcao: sanitizeText(form.funcao, 120)!,
      turno: form.turno || null,
      status: (form.status as StatusColab) ?? "ativo",
      data_admissao: form.data_admissao || null,
      observacoes: sanitizeText(form.observacoes, 1000),
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
        <div className="space-y-1.5"><Label>Função *</Label><Input value={form.funcao ?? ""} onChange={(e) => setForm({ ...form, funcao: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Turno</Label>
          <Select value={form.turno ?? ""} onValueChange={(v) => setForm({ ...form, turno: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{TURNOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Status</Label>
          <Select value={form.status ?? "ativo"} onValueChange={(v) => setForm({ ...form, status: v as StatusColab })}>
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

// ---------- Importação em massa via Excel ----------

type ImportError = { linha: number; matricula?: string; motivo: string };
type ImportResult = { sucesso: number; erros: ImportError[] };

const TURNO_SET = new Set<string>(TURNOS as readonly string[]);
const STATUS_SET = new Set<string>(STATUS_COLAB as readonly string[]);

function normalizeTurno(v: any): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (TURNO_SET.has(s)) return s;
  const low = s.toLowerCase().replace(/[ºo°]/g, "").replace(/\s+/g, " ");
  if (/^turno ?1$|^1 turno$/.test(low)) return "Turno 1";
  if (/^turno ?2$|^2 turno$/.test(low)) return "Turno 2";
  if (/^turno ?3$|^3 turno$/.test(low)) return "Turno 3";
  if (/admin/.test(low)) return "Administrativo";
  return null;
}
function normalizeStatus(v: any): StatusColab | null {
  if (v == null || v === "") return "ativo";
  const s = String(v).trim().toLowerCase();
  if (STATUS_SET.has(s)) return s as StatusColab;
  return null;
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Matricula", "Nome", "Funcao", "Turno", "Status"],
    ["12345", "João da Silva", "Operador de produção", "Turno 1", "ativo"],
    ["12346", "Maria Souza", "Analista", "Administrativo", "ativo"],
  ]);
  ws["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 28 }, { wch: 16 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Colaboradores");
  XLSX.writeFile(wb, "modelo_colaboradores.xlsx");
}

function ImportDialog({ onClose, existing }: { onClose: () => void; existing: Colab[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setProcessing(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      if (rows.length === 0) { toast.error("Planilha vazia"); setProcessing(false); return; }

      const erros: ImportError[] = [];
      const validos: any[] = [];
      const matriculasExistentes = new Set(existing.map((c) => c.matricula));
      const matriculasNoArquivo = new Set<string>();

      rows.forEach((r, idx) => {
        const linha = idx + 2; // header é linha 1
        const matricula = String(r.Matricula ?? r.matricula ?? "").trim();
        const nome = String(r.Nome ?? r.nome ?? "").trim();
        const funcao = String(r.Funcao ?? r["Função"] ?? r.funcao ?? "").trim();
        const turnoRaw = r.Turno ?? r.turno ?? "";
        const statusRaw = r.Status ?? r.status ?? "";

        if (!matricula) return erros.push({ linha, motivo: "Matrícula vazia" });
        if (!nome) return erros.push({ linha, matricula, motivo: "Nome vazio" });
        if (!funcao) return erros.push({ linha, matricula, motivo: "Função vazia" });
        if (matriculasExistentes.has(matricula)) return erros.push({ linha, matricula, motivo: "Matrícula já cadastrada" });
        if (matriculasNoArquivo.has(matricula)) return erros.push({ linha, matricula, motivo: "Matrícula duplicada na planilha" });

        const turno = turnoRaw ? normalizeTurno(turnoRaw) : null;
        if (turnoRaw && !turno) return erros.push({ linha, matricula, motivo: `Turno inválido: "${turnoRaw}"` });

        const status = normalizeStatus(statusRaw);
        if (!status) return erros.push({ linha, matricula, motivo: `Status inválido: "${statusRaw}"` });

        matriculasNoArquivo.add(matricula);
        validos.push({ matricula, nome, funcao, turno, status });
      });

      let sucesso = 0;
      if (validos.length > 0) {
        // Insere um por vez para capturar erros individuais (matrícula única, etc.)
        for (const row of validos) {
          const { error } = await supabase.from("colaboradores").insert(row);
          if (error) {
            erros.push({ linha: -1, matricula: row.matricula, motivo: error.message });
          } else {
            sucesso++;
          }
        }
      }

      setResult({ sucesso, erros });
      if (sucesso > 0) toast.success(`${sucesso} colaborador(es) importado(s)`);
      if (erros.length > 0) toast.warning(`${erros.length} linha(s) com erro`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao ler planilha");
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function exportErrors() {
    if (!result?.erros.length) return;
    const ws = XLSX.utils.json_to_sheet(result.erros.map((e) => ({
      Linha: e.linha === -1 ? "—" : e.linha,
      Matricula: e.matricula ?? "",
      Motivo: e.motivo,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Erros");
    XLSX.writeFile(wb, "erros_importacao.xlsx");
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Importar colaboradores via Excel</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <Card className="p-4 text-sm space-y-2">
          <p className="font-medium">Formato esperado</p>
          <p className="text-muted-foreground">
            Colunas: <code className="text-xs">Matricula</code>, <code className="text-xs">Nome</code>, <code className="text-xs">Funcao</code>, <code className="text-xs">Turno</code>, <code className="text-xs">Status</code>.
          </p>
          <p className="text-muted-foreground text-xs">
            Turno aceita: Turno 1, Turno 2, Turno 3, Administrativo. Status aceita: ativo, afastado, desligado.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" /> Baixar modelo .xlsx
          </Button>
        </Card>

        <div className="space-y-1.5">
          <Label>Arquivo .xlsx</Label>
          <Input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            disabled={processing}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        {processing && <p className="text-sm text-muted-foreground">Processando…</p>}

        {result && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-success font-medium">✓ {result.sucesso} importados</span>
              <span className={result.erros.length ? "text-destructive font-medium" : "text-muted-foreground"}>
                ✕ {result.erros.length} com erro
              </span>
              {result.erros.length > 0 && (
                <Button variant="outline" size="sm" className="ml-auto" onClick={exportErrors}>
                  <Download className="h-4 w-4 mr-2" /> Baixar relatório de erros
                </Button>
              )}
            </div>
            {result.erros.length > 0 && (
              <div className="max-h-64 overflow-y-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5">Linha</th>
                      <th className="text-left px-2 py-1.5">Matrícula</th>
                      <th className="text-left px-2 py-1.5">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.erros.map((e, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1.5">{e.linha === -1 ? "—" : e.linha}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{e.matricula ?? ""}</td>
                        <td className="px-2 py-1.5 text-destructive">{e.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      <DialogFooter>
        <Button onClick={onClose}>Fechar</Button>
      </DialogFooter>
    </DialogContent>
  );
}
