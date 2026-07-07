import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ClipboardList, Play, Check, ChevronRight, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useAuth, canMovimentar } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inventario")({ component: InventarioPage });

function InventarioPage() {
  const { role, user } = useAuth();
  const pode = canMovimentar(role);
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [local, setLocal] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: inventarios = [] } = useQuery({
    queryKey: ["inventarios"],
    queryFn: async () => (await supabase.from("inventarios").select("*").order("data_inicio", { ascending: false })).data ?? [],
  });

  async function criar() {
    if (!local.trim()) { toast.error("Informe o local"); return; }
    setCreating(true);
    const { data, error } = await supabase.from("inventarios").insert({ local, responsavel: user?.id }).select().single();
    if (error) { toast.error(error.message); setCreating(false); return; }
    // popular itens com snapshot dos EPIs ativos do local (ou todos se não houver match)
    const { data: epis } = await supabase.from("epis").select("id,estoque_atual,localizacao").eq("status", "ativo");
    const filtrados = (epis ?? []).filter((e) => !e.localizacao || e.localizacao.toLowerCase().includes(local.toLowerCase()));
    const itens = (filtrados.length ? filtrados : epis ?? []).map((e) => ({
      inventario_id: data.id, epi_id: e.id, quantidade_sistema: e.estoque_atual,
    }));
    if (itens.length) await supabase.from("inventario_itens").insert(itens);
    setCreating(false); setNewOpen(false); setLocal(""); setActive(data.id);
    qc.invalidateQueries({ queryKey: ["inventarios"] });
    toast.success("Inventário iniciado!");
  }

  if (active) return <InventarioDetalhe id={active} onBack={() => { setActive(null); qc.invalidateQueries(); }} />;

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Inventário</h1>
          <p className="text-sm text-muted-foreground">Conte fisicamente o estoque e compare com o sistema</p>
        </div>
        {pode && (
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild><Button><Play className="h-4 w-4 mr-2" /> Iniciar inventário</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo inventário</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Local</Label>
                  <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Ex: Prateleira A ou Almoxarifado 1" />
                  <p className="text-xs text-muted-foreground">EPIs cuja localização contenha este texto serão incluídos.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancelar</Button>
                <Button onClick={criar} disabled={creating}>{creating ? "Criando…" : "Iniciar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid gap-3">
        {inventarios.map((inv: any) => (
          <Card key={inv.id} className="p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/40 transition" onClick={() => setActive(inv.id)}>
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-10 w-10 rounded-md grid place-items-center ${inv.status === "finalizado" ? "bg-success/15 text-success" : "bg-primary/10 text-primary"}`}>
                {inv.status === "finalizado" ? <Check className="h-5 w-5" /> : <ClipboardList className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <div className="font-semibold truncate">{inv.local}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(inv.data_inicio).toLocaleString("pt-BR")} · <span className="capitalize">{inv.status.replace("_", " ")}</span>
                </div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Card>
        ))}
        {inventarios.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground">Nenhum inventário ainda. Clique em "Iniciar inventário" para começar.</Card>
        )}
      </div>
    </div>
  );
}

function InventarioDetalhe({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: inv } = useQuery({
    queryKey: ["inv", id],
    queryFn: async () => (await supabase.from("inventarios").select("*").eq("id", id).single()).data,
  });
  const { data: itens = [] } = useQuery({
    queryKey: ["inv-itens", id],
    queryFn: async () => (await supabase.from("inventario_itens").select("*, epis(nome,categoria,tamanho)").eq("inventario_id", id)).data ?? [],
  });

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function salvar() {
    setSaving(true);
    const updates = Object.entries(counts).map(([itemId, val]) => ({
      id: itemId, quantidade_contada: val === "" ? null : Number(val),
    }));
    for (const u of updates) {
      await supabase.from("inventario_itens").update({ quantidade_contada: u.quantidade_contada }).eq("id", u.id);
    }
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["inv-itens", id] });
    toast.success("Progresso salvo");
  }

  async function finalizar() {
    if (!confirm("Finalizar inventário? As diferenças serão aplicadas ao estoque como ajustes rastreáveis e o inventário não poderá mais ser editado.")) return;
    await salvar();
    const { error } = await supabase.rpc("finalizar_inventario", {
      p_inventario_id: id,
      p_usuario: user?.id ?? "",
    });
    if (error) { toast.error(`Falha ao finalizar: ${error.message}`); return; }
    toast.success("Inventário finalizado e estoque ajustado");
    onBack();
  }


  const finalizado = inv?.status === "finalizado";

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <Button variant="ghost" size="sm" onClick={onBack}>← Voltar</Button>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{inv?.local}</h1>
        <p className="text-sm text-muted-foreground">{itens.length} itens · {finalizado ? "Finalizado" : "Em andamento"}</p>
      </div>

      <div className="space-y-2">
        {itens.map((it: any) => {
          const contado = counts[it.id] ?? (it.quantidade_contada?.toString() ?? "");
          const diff = contado === "" ? null : Number(contado) - it.quantidade_sistema;
          return (
            <Card key={it.id} className="p-4">
              <div className="flex justify-between items-start gap-3 mb-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{it.epis?.nome}</div>
                  <div className="text-xs text-muted-foreground">{it.epis?.categoria} {it.epis?.tamanho ? `· ${it.epis.tamanho}` : ""}</div>
                </div>
                {diff !== null && diff !== 0 && (
                  <div className={`flex items-center gap-1 text-xs font-medium ${diff > 0 ? "text-success" : "text-destructive"}`}>
                    <AlertTriangle className="h-3 w-3" /> {diff > 0 ? "+" : ""}{diff}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <Label className="text-xs">Sistema</Label>
                  <div className="h-10 rounded-md border bg-muted/50 grid place-items-center font-semibold">{it.quantidade_sistema}</div>
                </div>
                <div>
                  <Label className="text-xs">Contado</Label>
                  <Input type="number" min={0} disabled={finalizado} inputMode="numeric"
                    value={contado}
                    onChange={(e) => setCounts({ ...counts, [it.id]: e.target.value })}
                    className="text-center font-semibold" />
                </div>
                <div>
                  <Label className="text-xs">Diferença</Label>
                  <div className={`h-10 rounded-md border grid place-items-center font-semibold ${
                    diff === null ? "bg-muted/30 text-muted-foreground" :
                    diff === 0 ? "bg-success/10 text-success border-success/30" :
                    "bg-warning/10 text-warning border-warning/30"
                  }`}>{diff === null ? "—" : (diff > 0 ? `+${diff}` : diff)}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!finalizado && (
        <div className="sticky bottom-20 md:bottom-4 flex gap-2 bg-background/80 backdrop-blur p-3 rounded-lg border shadow-lg">
          <Button variant="outline" className="flex-1" onClick={salvar} disabled={saving}>Salvar progresso</Button>
          <Button className="flex-1" onClick={finalizar} disabled={saving}><Check className="h-4 w-4 mr-2" /> Finalizar</Button>
        </div>
      )}
    </div>
  );
}
