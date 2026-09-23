import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth, canMovimentar } from "@/lib/auth";
import { ITENS_TAMANHO, TIPO_GRUPO, TIPO_LABEL, norm } from "@/lib/consumo";
import { sanitizeText } from "@/lib/sanitize";

export const Route = createFileRoute("/_app/colaboradores_/$id")({
  component: FichaColab,
  head: () => ({
    meta: [
      { title: "Ficha do colaborador · EPI Control" },
      { name: "description", content: "Dados do colaborador, tamanhos de EPI, EPIs em posse e histórico completo de entregas." },
      { property: "og:title", content: "Ficha do colaborador · EPI Control" },
      { property: "og:description", content: "Dados do colaborador, tamanhos de EPI, EPIs em posse e histórico de entregas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const fmtData = (s: string) => new Date(s).toLocaleDateString("pt-BR");

function FichaColab() {
  const { id } = Route.useParams();
  const { role } = useAuth();
  const podeEditar = canMovimentar(role);
  const qc = useQueryClient();

  const { data: colab } = useQuery({
    queryKey: ["colab", id],
    queryFn: async () => (await supabase.from("colaboradores").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: tamanhos = [] } = useQuery({
    queryKey: ["colab-tamanhos", id],
    queryFn: async () => (await supabase.from("colaborador_tamanhos").select("id,item,tamanho").eq("colaborador_id", id).order("item")).data ?? [],
  });

  const { data: movs = [] } = useQuery({
    queryKey: ["colab-movs", id],
    queryFn: async () => {
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("movimentacoes")
          .select("id,tipo,quantidade,motivo,observacao,data_movimentacao,usuario_responsavel,epi_id,epis(nome,categoria,tamanho,modelo)")
          .eq("colaborador_id", id)
          .order("data_movimentacao", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const ids = Array.from(new Set(all.map((m) => m.usuario_responsavel).filter(Boolean))) as string[];
      const nomes = new Map<string, string>();
      if (ids.length) {
        const { data } = await supabase.rpc("nomes_responsaveis", { p_ids: ids });
        (data ?? []).forEach((p: any) => nomes.set(p.id, p.nome));
      }
      return all.map((m) => ({ ...m, responsavel: m.usuario_responsavel ? nomes.get(m.usuario_responsavel) ?? "—" : "—" }));
    },
  });

  // EPIs em posse = saldo por EPI a partir das movimentações reais do colaborador:
  //   + entrega   − troca/devolução/avaria/descarte/perda/roubo (saída do EPI anterior)
  const emPosse = useMemo(() => {
    const SAIDA_POSSE = new Set(["troca", "devolucao_normal", "avariado", "descarte", "perda", "roubo"]);
    const porEpi = new Map<string, { epi_id: string; epis: any; saldo: number; ultima: string }>();
    for (const m of movs) {
      const sinal = m.tipo === "entrega" ? 1 : SAIDA_POSSE.has(m.tipo) ? -1 : 0;
      if (!sinal) continue;
      const cur = porEpi.get(m.epi_id) ?? { epi_id: m.epi_id, epis: m.epis, saldo: 0, ultima: "" };
      cur.saldo += sinal * Number(m.quantidade ?? 0);
      if (m.tipo === "entrega" && m.data_movimentacao > cur.ultima) cur.ultima = m.data_movimentacao;
      porEpi.set(m.epi_id, cur);
    }
    return Array.from(porEpi.values()).filter((p) => p.saldo > 0).sort((a, b) => b.ultima.localeCompare(a.ultima));
  }, [movs]);

  // Turno histórico: reconstruído pelas alterações de turno registradas na auditoria (visível a admins).
  const { data: mudTurno = [] } = useQuery({
    queryKey: ["colab-turno-hist", id],
    queryFn: async () => (await supabase.from("auditoria")
      .select("created_at,dados_anteriores,dados_novos")
      .eq("tabela", "colaboradores").eq("registro_id", id).eq("operacao", "UPDATE")
      .order("created_at", { ascending: true })).data ?? [],
  });
  const trocasTurno = useMemo(
    () => (mudTurno as any[]).filter((a) => (a.dados_anteriores?.turno ?? null) !== (a.dados_novos?.turno ?? null)),
    [mudTurno],
  );
  const turnoNaData = (data: string): { turno: string; historico: boolean } => {
    const prox = trocasTurno.find((a) => a.created_at > data);
    if (prox) return { turno: prox.dados_anteriores?.turno ?? "—", historico: true };
    return { turno: colab?.turno ?? "—", historico: trocasTurno.length > 0 && data >= trocasTurno[trocasTurno.length - 1].created_at };
  };

  // form de tamanhos
  const [novoItem, setNovoItem] = useState("");
  const [novoTam, setNovoTam] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTam, setEditTam] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["colab-tamanhos", id] });

  async function adicionar() {
    const item = sanitizeText(novoItem, 60)?.trim(); const tam = sanitizeText(novoTam, 20)?.trim();
    if (!item || !tam) { toast.error("Informe o item e o tamanho"); return; }
    const existente = tamanhos.find((t) => norm(t.item) === norm(item));
    const { error } = existente
      ? await supabase.from("colaborador_tamanhos").update({ tamanho: tam }).eq("id", existente.id)
      : await supabase.from("colaborador_tamanhos").insert({ colaborador_id: id, item, tamanho: tam });
    if (error) { toast.error(error.message); return; }
    toast.success(existente ? "Tamanho atualizado" : "Tamanho cadastrado");
    setNovoItem(""); setNovoTam(""); refresh();
  }
  async function salvarEdicao(tid: string) {
    const tam = sanitizeText(editTam, 20)?.trim();
    if (!tam) { toast.error("Informe o tamanho"); return; }
    const { error } = await supabase.from("colaborador_tamanhos").update({ tamanho: tam }).eq("id", tid);
    if (error) { toast.error(error.message); return; }
    setEditId(null); refresh();
  }
  async function remover(tid: string) {
    const { error } = await supabase.from("colaborador_tamanhos").delete().eq("id", tid);
    if (error) toast.error(error.message); else refresh();
  }

  const itensDisponiveis = ITENS_TAMANHO.filter((i) => !tamanhos.some((t) => norm(t.item) === norm(i)));

  return (
    <div className="p-4 md:p-8 space-y-5">
      <Button asChild variant="ghost" size="sm"><Link to="/colaboradores"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>

      {/* 1. Dados */}
      <Card className="p-6">
        {colab ? (
          <>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{colab.nome}</h1>
            <div className="text-sm text-muted-foreground mt-1">
              Matrícula {colab.matricula} · {colab.funcao}{colab.turno ? ` · ${colab.turno}` : ""} · {colab.status}
            </div>
            {colab.observacoes && <p className="mt-3 text-sm">{colab.observacoes}</p>}
          </>
        ) : <div className="text-muted-foreground">Carregando…</div>}
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* 2. Tamanhos */}
        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tamanhos de EPI</h2>
          {tamanhos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum tamanho cadastrado.</p>}
          <div className="grid sm:grid-cols-2 gap-2">
            {tamanhos.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm">{t.item}</span>
                {editId === t.id ? (
                  <span className="flex items-center gap-1">
                    <Input className="h-8 w-20" value={editTam} onChange={(e) => setEditTam(e.target.value)} autoFocus />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => salvarEdicao(t.id)}><Save className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditId(null)}><X className="h-4 w-4" /></Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <span className="text-lg font-bold tabular-nums">{t.tamanho}</span>
                    {podeEditar && <>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => { setEditId(t.id); setEditTam(t.tamanho); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Remover" onClick={() => remover(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </>}
                  </span>
                )}
              </div>
            ))}
          </div>
          {podeEditar && (
            <div className="flex flex-wrap gap-2 items-end pt-2 border-t">
              <div className="flex-1 min-w-[140px]">
                <Input list="itens-tamanho" placeholder="Item (ex.: Camisa)" value={novoItem} onChange={(e) => setNovoItem(e.target.value)} />
                <datalist id="itens-tamanho">{itensDisponiveis.map((i) => <option key={i} value={i} />)}</datalist>
              </div>
              <Input className="w-28" placeholder="Tamanho" value={novoTam} onChange={(e) => setNovoTam(e.target.value)} />
              <Button onClick={adicionar}><Plus className="h-4 w-4 mr-1" /> Salvar</Button>
            </div>
          )}
        </Card>

        {/* 3. Em posse */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">EPIs atualmente em posse</h2>
          <p className="text-xs text-muted-foreground">Saldo por EPI: entregas menos trocas, devoluções, avarias, descartes, perdas e roubos registrados.</p>
          {emPosse.length === 0 && <p className="text-sm text-muted-foreground">Nenhum EPI entregue.</p>}
          <ul className="divide-y">
            {emPosse.map((p) => (
              <li key={p.epi_id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{p.epis?.nome}{p.epis?.tamanho ? ` · ${p.epis.tamanho}` : ""}</div>
                  <div className="text-xs text-muted-foreground">{p.epis?.categoria}{p.ultima ? ` · última entrega em ${fmtData(p.ultima)}` : ""}</div>
                </div>
                <span className="text-lg font-bold tabular-nums">{p.saldo}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* 4. Histórico */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Histórico de EPI</h2>
          <span className="text-xs text-muted-foreground">{movs.length} registro(s) · * turno atual (sem registro histórico do turno na data)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th className="text-left">Data</th>
                <th className="text-left">EPI</th>
                <th className="text-left">Tamanho/modelo</th>
                <th className="num">Qtd</th>
                <th className="text-left">Tipo</th>
                <th className="text-left">Responsável</th>
                <th className="text-left">Turno</th>
                <th className="text-left">Observação</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m: any) => (
                <tr key={m.id} className={TIPO_GRUPO[m.tipo] === "saida" ? "" : "text-muted-foreground"}>
                  <td className="whitespace-nowrap">{fmtData(m.data_movimentacao)}</td>
                  <td className="font-medium text-foreground">{m.epis?.nome ?? "—"}</td>
                  <td>{[m.epis?.tamanho, m.epis?.modelo].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="num font-semibold">{m.quantidade}</td>
                  <td><span className="text-xs font-medium">{TIPO_LABEL[m.tipo] ?? m.tipo}</span></td>
                  <td>{m.responsavel}</td>
                  <td>{(() => { const t = turnoNaData(m.data_movimentacao); return t.historico ? t.turno : <span title="Turno histórico não registrado para esta data; exibindo o turno atual">{t.turno}*</span>; })()}</td>
                  <td className="text-xs">{[m.motivo, m.observacao].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
              {movs.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">Sem movimentações registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
