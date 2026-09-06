import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Search, Pencil, Trash2, PackagePlus, Boxes, XCircle, AlertTriangle, CalendarClock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

import { CATEGORIAS_EPI } from "@/lib/constants";
import { useAuth, canManageRegistros, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";
import { StockBadge } from "@/components/StockBadge";
import { useEpiMetrics } from "@/hooks/use-epi-metrics";
import { DIAS_SEGURANCA_MINIMO, type NivelEstoque } from "@/lib/estoque-calc";
import { ConsumptionCell, CoverageIndicator, StatCard, StockLevel } from "@/components/metrics";

type NivelFiltro = "zerado" | "critico" | "abaixo" | "atencao";

export const Route = createFileRoute("/_app/epis")({
  component: EpisPage,
  validateSearch: (s: Record<string, unknown>): { nivel?: NivelFiltro } => {
    const n = s.nivel;
    return n === "zerado" || n === "critico" || n === "abaixo" || n === "atencao" ? { nivel: n } : {};
  },
});

type Epi = {
  id: string; nome: string; categoria: string; codigo_produto: string | null; ca: string | null; modelo: string | null;
  tamanho: string | null; estoque_atual: number; estoque_minimo: number; dias_seguranca: number;
  custo_unitario: number; localizacao: string | null; status: "ativo" | "inativo";
};

const NIVEL_FILTRO_LABEL: Record<NivelFiltro | "all", string> = {
  all: "Todos os níveis", zerado: "Zerados", critico: "Críticos", atencao: "Em atenção", abaixo: "Abaixo do mínimo",
};

function EpisPage() {
  const { role, user } = useAuth();
  const canEdit = canManageRegistros(role);
  const canEditStock = canMovimentar(role);
  const qc = useQueryClient();
  const { nivel: nivelUrl } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Epi | null>(null);
  const [entradaFor, setEntradaFor] = useState<Epi | null>(null);
  const { metricaDe, lead } = useEpiMetrics();
  const filterNivel: NivelFiltro | "all" = nivelUrl ?? "all";

  const { data: list = [] } = useQuery({
    queryKey: ["epis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("epis").select("*").order("nome");
      if (error) throw error;
      return data as Epi[];
    },
  });

  // Métricas do motor compartilhado (mesmos números de Compras/Dashboard)
  const linhas = useMemo(() => list.map((e) => ({ epi: e, m: metricaDe(e) })), [list, metricaDe]);

  const resumo = useMemo(() => {
    const ativos = linhas.filter((l) => l.epi.status === "ativo");
    const conta = (n: NivelEstoque) => ativos.filter((l) => l.m.nivel === n).length;
    const ruptura = ativos.filter((l) => l.m.ruptura && l.m.cobertura < lead.dias && l.epi.estoque_atual > 0).length;
    return { total: ativos.length, zerados: conta("zerado"), criticos: conta("critico"), atencao: conta("atencao"), ruptura };
  }, [linhas, lead.dias]);

  const filtered = linhas.filter(({ epi: e, m }) => {
    if (filterCat !== "all" && e.categoria !== filterCat) return false;
    if (filterNivel === "abaixo" ? e.estoque_atual >= m.minimoEfetivo : filterNivel !== "all" && m.nivel !== filterNivel) return false;
    if (search && !`${e.nome} ${e.ca} ${e.modelo} ${e.codigo_produto ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const setNivel = (v: string) => navigate({ search: v === "all" ? {} : { nivel: v as NivelFiltro }, replace: true });

  async function handleDelete(id: string, nome: string) {
    if (!confirm(`Excluir o EPI "${nome}"? Se houver movimentações, será apenas inativado para preservar o histórico.`)) return;
    const { data, error } = await supabase.rpc("excluir_epi_seguro", { p_epi_id: id });
    if (error) toast.error(error.message);
    else {
      toast.success(data === "excluido" ? "EPI excluído" : "EPI inativado (histórico preservado)");
      qc.invalidateQueries({ queryKey: ["epis"] });
    }
  }

  const acoes = (e: Epi, label = false) => (canEdit || canEditStock) && (
    <TooltipProvider delayDuration={200}>
      <div className="inline-flex gap-1">
        {canEditStock && (
          <Tooltip><TooltipTrigger asChild>
            <Button variant="outline" size={label ? "sm" : "icon"} onClick={() => setEntradaFor(e)}>
              <PackagePlus className="h-4 w-4" />{label && <span className="ml-1">Entrada</span>}
            </Button>
          </TooltipTrigger><TooltipContent>Entrada de estoque</TooltipContent></Tooltip>
        )}
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size={label ? "sm" : "icon"} onClick={() => { setEditing(e); setOpen(true); }}>
            <Pencil className="h-4 w-4" />{label && <span className="ml-1">Editar</span>}
          </Button>
        </TooltipTrigger><TooltipContent>Editar cadastro</TooltipContent></Tooltip>
        {role === "admin" && (
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size={label ? "sm" : "icon"} onClick={() => handleDelete(e.id, e.nome)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </TooltipTrigger><TooltipContent>Excluir / inativar</TooltipContent></Tooltip>
        )}
      </div>
    </TooltipProvider>
  );

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">EPIs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filtered.length} de {list.length} itens · mínimo recomendado = consumo diário × ({lead.dias} dias de lead time + {DIAS_SEGURANCA_MINIMO} de segurança)
          </p>
        </div>
        {(canEdit || canEditStock) && (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild><Button size="lg" onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-2" /> Novo EPI</Button></DialogTrigger>
            <EpiForm key={editing?.id ?? "new"} editing={editing} onClose={() => { setOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ["epis"] }); }} />
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Boxes} label="EPIs ativos" value={resumo.total} />
        <StatCard icon={XCircle} label="Zerados" value={resumo.zerados} tone={resumo.zerados ? "danger" : "neutral"} hint="sem estoque disponível" />
        <StatCard icon={AlertTriangle} label="Abaixo do mínimo" value={resumo.criticos} tone={resumo.criticos ? "danger" : "neutral"} hint="com estoque, abaixo do recomendado" />
        <StatCard icon={CalendarClock} label="Ruptura no ciclo" value={resumo.ruptura} tone={resumo.ruptura ? "warning" : "neutral"} hint={`acabam em menos de ${lead.dias} dias`} />
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, código, CA ou modelo…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="md:w-56"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIAS_EPI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterNivel} onValueChange={setNivel}>
          <SelectTrigger className="md:w-48"><SelectValue placeholder="Nível" /></SelectTrigger>
          <SelectContent>
            {(Object.keys(NIVEL_FILTRO_LABEL) as (NivelFiltro | "all")[]).map((k) => <SelectItem key={k} value={k}>{NIVEL_FILTRO_LABEL[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {/* Mobile */}
      <div className="grid md:hidden gap-3">
        {filtered.map(({ epi: e, m }) => (
          <Card key={e.id} className="p-4 space-y-3">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-base truncate">{e.nome}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Cód. {e.codigo_produto || "—"} · {e.categoria} · CA {e.ca || "—"} · {e.tamanho || "—"}</div>
              </div>
              <StockBadge atual={e.estoque_atual} minimo={m.minimoEfetivo} compact />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t">
              <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Estoque</div>
                <StockLevel atual={e.estoque_atual} minimoCalc={m.minimoCalc} minimoCadastrado={e.estoque_minimo} nivel={m.nivel} /></div>
              <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Consumo</div>
                <ConsumptionCell mensal={m.mensal} diario={m.diario} /></div>
              <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Cobertura</div>
                <CoverageIndicator cobertura={m.cobertura} ruptura={m.ruptura} leadDias={lead.dias} /></div>
            </div>
            {(canEdit || canEditStock) && <div className="flex justify-end pt-2 border-t">{acoes(e, true)}</div>}
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-center py-12 text-muted-foreground text-sm">Nenhum EPI encontrado.</p>}
      </div>

      {/* Desktop */}
      <Card className="overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>EPI</th>
                <th>Estoque</th>
                <th>Consumo</th>
                <th>Cobertura</th>
                <th>Status</th>
                <th className="num">Custo un.</th>
                <th className="num">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ epi: e, m }) => (
                <tr key={e.id} className={e.status === "inativo" ? "opacity-60" : ""}>
                  <td className="max-w-[320px]">
                    <div className="font-semibold text-[15px] leading-snug">{e.nome}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      <span className="font-mono">{e.codigo_produto || "—"}</span> · {e.categoria}
                      {e.ca && <> · CA {e.ca}</>}{e.tamanho && <> · {e.tamanho}</>}{e.modelo && <> · {e.modelo}</>}
                      {e.status === "inativo" && <> · <span className="font-medium">inativo</span></>}
                    </div>
                  </td>
                  <td><StockLevel atual={e.estoque_atual} minimoCalc={m.minimoCalc} minimoCadastrado={e.estoque_minimo} nivel={m.nivel} /></td>
                  <td><ConsumptionCell mensal={m.mensal} diario={m.diario} /></td>
                  <td><CoverageIndicator cobertura={m.cobertura} ruptura={m.ruptura} leadDias={lead.dias} /></td>
                  <td><StockBadge atual={e.estoque_atual} minimo={m.minimoEfetivo} compact /></td>
                  <td className="num text-muted-foreground whitespace-nowrap">R$ {Number(e.custo_unitario).toFixed(2)}</td>
                  <td className="num">{acoes(e)}</td>
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
  const [form, setForm] = useState<Partial<Epi>>(editing ? { ...editing } : { status: "ativo" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.nome || !form.categoria) { toast.error("Nome e categoria são obrigatórios"); return; }
    setSaving(true);
    // A1: ao editar NÃO permite alterar estoque_atual — use "Entrada de estoque" ou inventário.
    const basePayload = {
      nome: form.nome!, categoria: form.categoria!, ca: form.ca || null, modelo: form.modelo || null,
      tamanho: form.tamanho || null, codigo_produto: form.codigo_produto || null,
      estoque_minimo: Number(form.estoque_minimo ?? 0), custo_unitario: Number(form.custo_unitario ?? 0),
      dias_seguranca: Number(form.dias_seguranca ?? 20),

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
        <div className="space-y-1.5"><Label>Código do produto</Label><Input value={form.codigo_produto ?? ""} onChange={(e) => setForm({ ...form, codigo_produto: e.target.value })} placeholder="Ex: PRD-00123" /></div>
        <div className="space-y-1.5"><Label>CA</Label><Input value={form.ca ?? ""} onChange={(e) => setForm({ ...form, ca: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Modelo</Label><Input value={form.modelo ?? ""} onChange={(e) => setForm({ ...form, modelo: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Tamanho</Label><Input value={form.tamanho ?? ""} onChange={(e) => setForm({ ...form, tamanho: e.target.value })} /></div>
        <div className="space-y-1.5">
          <Label>{editing ? "Estoque atual (somente leitura)" : "Estoque inicial"}</Label>
          <Input
            type="number" min={0}
            value={form.estoque_atual ?? ""}
            disabled={!!editing}
            placeholder="0"
            onChange={(e) => setForm({ ...form, estoque_atual: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          {editing
            ? <p className="text-[11px] text-muted-foreground">Use “Entrada de estoque” ou inventário para alterar.</p>
            : <p className="text-[11px] text-muted-foreground">Registrado como entrada rastreável.</p>}
        </div>

        <div className="space-y-1.5"><Label>Estoque mínimo</Label><Input type="number" min={0} placeholder="0" value={form.estoque_minimo ?? ""} onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value === "" ? undefined : Number(e.target.value) })} /></div>
        <div className="space-y-1.5"><Label>Dias de estoque de segurança</Label><Input type="number" min={0} placeholder="20" value={form.dias_seguranca ?? ""} onChange={(e) => setForm({ ...form, dias_seguranca: e.target.value === "" ? undefined : Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground">Usado no Planejamento de Compras.</p></div>

        <div className="space-y-1.5"><Label>Custo unitário (R$)</Label><Input type="number" step="0.01" min={0} placeholder="0,00" value={form.custo_unitario ?? ""} onChange={(e) => setForm({ ...form, custo_unitario: e.target.value === "" ? undefined : Number(e.target.value) })} /></div>
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
