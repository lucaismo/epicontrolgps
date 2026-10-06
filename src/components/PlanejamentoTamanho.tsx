import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatCard, fmtNum } from "@/components/metrics";
import { Ruler, UserCheck, UserX, AlertTriangle, Search } from "lucide-react";
import { useEpiMetrics } from "@/hooks/use-epi-metrics";
import { fetchPaginado, norm, TAMANHOS_PRINCIPAIS } from "@/lib/consumo";
import type { EpiCalc } from "@/lib/estoque-calc";

type Tipo = (typeof TAMANHOS_PRINCIPAIS)[number];
type Situacao = "critico" | "atencao" | "normal" | "semdados";
const SIT_LABEL: Record<Situacao, string> = { critico: "Crítico", atencao: "Atenção", normal: "Normal", semdados: "Sem dados" };
const SIT_CLASS: Record<Situacao, string> = {
  critico: "status-pill status-critical", atencao: "status-pill status-warning",
  normal: "status-pill status-normal", semdados: "status-pill status-nodata",
};
const TAM_RE = /^(PP|P|M|G|GG|XG|XGG|EG|EGG|G1|G2|G3|\d{2})$/i;

type Epi = EpiCalc & { nome: string; tamanho: string | null };

/** Tipo (Camisa/Calça/Bota) e tamanho do EPI. Só retorna quando a correspondência é confiável. */
function tipoTamanhoDoEpi(e: Epi): { tipo: Tipo; tam: string } | null {
  const tokens = e.nome.trim().split(/\s+/);
  const tipo = TAMANHOS_PRINCIPAIS.find((t) => norm(tokens[0]).startsWith(norm(t)));
  if (!tipo) return null;
  const tam = e.tamanho?.trim() || tokens.slice(1).find((t) => TAM_RE.test(t));
  return tam ? { tipo, tam: tam.toUpperCase() } : null;
}

type Linha = {
  key: string; epi: Epi | null; tipo: Tipo; tam: string; pessoas: number;
  estoque: number; transito: number; c90: number; cobertura: number; sugerido: number; situacao: Situacao;
};

export function PlanejamentoTamanho() {
  const { metricaDe } = useEpiMetrics();
  const [tipoF, setTipoF] = useState<"all" | Tipo>("all");
  const [tamF, setTamF] = useState("all");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Linha | null>(null);

  const { data: epis = [] } = useQuery({
    queryKey: ["compras-epis"],
    queryFn: async () => ((await supabase.from("epis").select("*").eq("status", "ativo").order("nome")).data ?? []) as unknown as Epi[],
  });
  const { data: colabs = [] } = useQuery({
    queryKey: ["plan-tam-colabs"],
    queryFn: () => fetchPaginado<{ id: string; nome: string; matricula: string; funcao: string }>((f, t) =>
      supabase.from("colaboradores").select("id,nome,matricula,funcao").eq("status", "ativo").order("nome").range(f, t) as any),
  });
  const { data: tams = [] } = useQuery({
    queryKey: ["plan-tam-tamanhos"],
    queryFn: () => fetchPaginado<{ colaborador_id: string; item: string; tamanho: string }>((f, t) =>
      supabase.from("colaborador_tamanhos").select("colaborador_id,item,tamanho").order("id").range(f, t) as any),
  });

  const dados = useMemo(() => {
    const ativos = new Set(colabs.map((c) => c.id));
    const porColab = new Map<string, Map<string, string>>();
    const base = new Map<string, number>(); // "tipo|TAM" -> pessoas
    for (const r of tams) {
      if (!ativos.has(r.colaborador_id) || !r.tamanho?.trim()) continue;
      const tipo = TAMANHOS_PRINCIPAIS.find((t) => norm(t) === norm(r.item));
      if (!tipo) continue;
      const tam = r.tamanho.trim().toUpperCase();
      const m = porColab.get(r.colaborador_id) ?? new Map(); m.set(tipo, tam); porColab.set(r.colaborador_id, m);
      base.set(`${tipo}|${tam}`, (base.get(`${tipo}|${tam}`) ?? 0) + 1);
    }
    const completos = colabs.filter((c) => (porColab.get(c.id)?.size ?? 0) === TAMANHOS_PRINCIPAIS.length).length;
    const pendentes = colabs
      .map((c) => ({ ...c, faltam: TAMANHOS_PRINCIPAIS.filter((t) => !porColab.get(c.id)?.has(t)) }))
      .filter((c) => c.faltam.length > 0);

    const linhas: Linha[] = [];
    const usadas = new Set<string>();
    for (const e of epis) {
      const tt = tipoTamanhoDoEpi(e);
      if (!tt) continue;
      const k = `${tt.tipo}|${tt.tam}`; usadas.add(k);
      const m = metricaDe(e);
      const pessoas = base.get(k) ?? 0;
      let situacao: Situacao;
      if (e.estoque_atual <= 0 || m.prioridade === "alta") situacao = "critico";
      else if (pessoas === 0) situacao = "semdados";
      else if (e.estoque_atual < pessoas || m.prioridade === "media") situacao = "atencao";
      else situacao = "normal";
      linhas.push({ key: e.id, epi: e, tipo: tt.tipo, tam: tt.tam, pessoas, estoque: e.estoque_atual,
        transito: m.transito, c90: m.c.d90, cobertura: m.cobertura, sugerido: m.sugerido, situacao });
    }
    for (const [k, pessoas] of base) {
      if (usadas.has(k)) continue;
      const [tipo, tam] = k.split("|") as [Tipo, string];
      linhas.push({ key: k, epi: null, tipo, tam, pessoas, estoque: 0, transito: 0, c90: 0, cobertura: NaN, sugerido: 0, situacao: "semdados" });
    }
    linhas.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.tam.localeCompare(b.tam, "pt-BR", { numeric: true }));
    const abaixo = linhas.filter((l) => l.epi && l.pessoas > 0 && l.estoque < l.pessoas).length;
    return { linhas, completos, pendentes, abaixo, itens: linhas.filter((l) => l.epi).length };
  }, [epis, colabs, tams, metricaDe]);

  const tamanhos = useMemo(() => [...new Set(dados.linhas.filter((l) => tipoF === "all" || l.tipo === tipoF).map((l) => l.tam))], [dados.linhas, tipoF]);
  const filtradas = dados.linhas.filter((l) =>
    (tipoF === "all" || l.tipo === tipoF) && (tamF === "all" || l.tam === tamF) &&
    (!busca || norm(l.epi?.nome ?? `${l.tipo} ${l.tam}`).includes(norm(busca))));

  const cob = (l: Linha) => !l.epi ? "—" : Number.isFinite(l.cobertura) ? `${Math.floor(l.cobertura)} dias` : "Sem consumo";
  const pctBase = (l: Linha) => l.epi && l.pessoas > 0 ? Math.round((l.estoque / l.pessoas) * 100) : null;
  const nome = (l: Linha) => l.epi?.nome ?? `${l.tipo} ${l.tam} (sem EPI cadastrado)`;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <StatCard icon={UserCheck} label="Tamanhos cadastrados" value={dados.completos} hint="colaboradores ativos com camisa, calça e bota" />
        <StatCard icon={UserX} label="Tamanhos pendentes" value={dados.pendentes.length} tone={dados.pendentes.length ? "warning" : "neutral"} hint="colaboradores com algum tamanho em branco" />
        <StatCard icon={Ruler} label="Itens com tamanho" value={dados.itens} hint="EPIs de camisa, calça e bota encontrados" />
        <StatCard icon={AlertTriangle} label="Abaixo da base" value={dados.abaixo} tone={dados.abaixo ? "warning" : "neutral"} hint="estoque menor que pessoas cadastradas" />
      </div>

      <p className="text-xs text-muted-foreground">
        "Pessoas cadastradas" é a base de demanda, não a quantidade a comprar. A compra sugerida é a mesma da visão de estoque.
      </p>

      <div className="flex flex-wrap gap-2">
        <Select value={tipoF} onValueChange={(v) => { setTipoF(v as any); setTamF("all"); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os itens</SelectItem>
            {TAMANHOS_PRINCIPAIS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tamF} onValueChange={setTamF}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Tamanho" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tamanhos</SelectItem>
            {tamanhos.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar EPI" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {/* Desktop */}
      <Card className="hidden md:block overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>{["EPI", "Tamanho", "Pessoas cadastradas", "Estoque atual", "Em trânsito", "Consumo 90 dias", "Cobertura", "Compra sugerida", "Situação"].map((h) =>
              <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr key={l.key} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => setSel(l)}>
                <td className="px-3 py-2 font-medium">{nome(l)}</td>
                <td className="px-3 py-2">{l.tam}</td>
                <td className="px-3 py-2 num">{l.pessoas}{pctBase(l) !== null && <span className="block text-xs text-muted-foreground">estoque cobre {pctBase(l)}%</span>}</td>
                <td className="px-3 py-2 num">{l.epi ? fmtNum(l.estoque) : "—"}</td>
                <td className="px-3 py-2 num">{l.epi ? fmtNum(l.transito) : "—"}</td>
                <td className="px-3 py-2 num">{l.epi ? fmtNum(l.c90) : "—"}</td>
                <td className="px-3 py-2 num">{cob(l)}</td>
                <td className="px-3 py-2 num font-semibold">{l.epi ? fmtNum(l.sugerido) : "—"}</td>
                <td className="px-3 py-2"><span className={SIT_CLASS[l.situacao]}>{SIT_LABEL[l.situacao]}</span></td>
              </tr>
            ))}
            {!filtradas.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Nenhum item encontrado.</td></tr>}
          </tbody>
        </table>
      </Card>

      {/* Celular */}
      <div className="md:hidden space-y-2">
        {filtradas.map((l) => (
          <Card key={l.key} className="p-3 space-y-2 cursor-pointer" onClick={() => setSel(l)}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{nome(l)}</div>
              <span className={SIT_CLASS[l.situacao]}>{SIT_LABEL[l.situacao]}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Pessoas</span><span className="num text-right">{l.pessoas}</span>
              <span className="text-muted-foreground">Estoque</span><span className="num text-right">{l.epi ? fmtNum(l.estoque) : "—"}</span>
              <span className="text-muted-foreground">Cobertura</span><span className="num text-right">{cob(l)}</span>
              <span className="text-muted-foreground">Compra sugerida</span><span className="num text-right font-semibold">{l.epi ? fmtNum(l.sugerido) : "—"}</span>
            </div>
          </Card>
        ))}
        {!filtradas.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum item encontrado.</p>}
      </div>

      <details className="rounded-lg border bg-card text-sm">
        <summary className="cursor-pointer px-4 py-2.5"><span className="type-label">Tamanhos pendentes</span> <b className="num ml-2">{dados.pendentes.length}</b> <span className="text-xs text-muted-foreground">colaboradores</span></summary>
        <div className="border-t max-h-96 overflow-y-auto divide-y">
          {dados.pendentes.map((c) => (
            <div key={c.id} className="px-4 py-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <span className="font-medium text-sm">{c.nome}</span>
              <span className="text-muted-foreground num">{c.matricula}</span>
              <span className="text-muted-foreground">{c.funcao}</span>
              <span className="ml-auto text-warning-ink">Falta: {c.faltam.join(", ")}</span>
            </div>
          ))}
          {!dados.pendentes.length && <p className="px-4 py-3 text-muted-foreground">Nenhuma pendência.</p>}
        </div>
      </details>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{sel && nome(sel)}</DialogTitle></DialogHeader>
          {sel && (
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {([
                ["Tamanho", sel.tam],
                ["Colaboradores com esse tamanho", String(sel.pessoas)],
                ["Estoque atual", sel.epi ? fmtNum(sel.estoque) : "—"],
                ["Em trânsito", sel.epi ? fmtNum(sel.transito) : "—"],
                ["Consumo 90 dias", sel.epi ? fmtNum(sel.c90) : "—"],
                ["Cobertura atual", cob(sel)],
                ["Compra sugerida", sel.epi ? fmtNum(sel.sugerido) : "—"],
                ["Estoque / base cadastrada", pctBase(sel) !== null ? `${pctBase(sel)}%` : "—"],
                ["Situação", SIT_LABEL[sel.situacao]],
              ] as const).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="num text-right font-medium">{v}</dd></div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
