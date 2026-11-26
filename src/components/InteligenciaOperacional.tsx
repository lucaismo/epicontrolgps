import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import type { Insight, PrioridadeInsight } from "@/lib/inteligencia-operacional";
import { DESTINO_INSIGHT, type GrupoInsight, type ResultadoIntegracao } from "@/lib/inteligencia-integracao";

const TIPO_LABEL: Record<Insight["tipo"], string> = {
  CONSUMO_EM_ALTA: "Consumo em alta", CONSUMO_EM_QUEDA: "Consumo em queda",
  CONSUMO_ELEVADO_PERSISTENTE: "Consumo elevado persistente", ESTOQUE_DEPENDE_DE_PEDIDO: "Estoque depende de pedido",
  COBERTURA_EXCESSIVA: "Cobertura excessiva", CONCENTRACAO_POR_TAMANHO: "Concentração por tamanho",
  DADOS_INSUFICIENTES: "Dados insuficientes",
};
const PRIO: Record<PrioridadeInsight, { label: string; cls: string }> = {
  ALTA: { label: "Alta", cls: "status-critical" }, MEDIA: { label: "Média", cls: "status-warning" },
  BAIXA: { label: "Baixa", cls: "status-neutral" }, INFO: { label: "Info", cls: "status-nodata" },
};
const fmtD = (s: string) => s.split("-").reverse().join("/");

function Card({ g }: { g: GrupoInsight }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b last:border-b-0">
      <Button variant="ghost" type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="h-auto w-full justify-start whitespace-normal flex items-center gap-3 px-4 py-4 text-left hover:bg-muted/40">
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium break-words">{g.epiNome}{g.epiCodigo && <span className="type-aux ml-2">{g.epiCodigo}</span>}</div>
          <div className="type-aux mt-1 break-words">{g.insights.map((i) => TIPO_LABEL[i.tipo]).join(" · ")}</div>
        </div>
        <span className={`status-pill ${PRIO[g.prioridade].cls}`}>{PRIO[g.prioridade].label}</span>
      </Button>
      {open && (
        <div className="px-4 pb-3 pl-11 space-y-3">
          {g.insights.map((i, k) => (
            <div key={k} className="text-sm space-y-1">
              <div className="font-medium">{TIPO_LABEL[i.tipo]}
                {i.periodo && <span className="type-aux ml-2">{fmtD(i.periodo.inicio)} a {fmtD(i.periodo.fim)}</span>}
              </div>
              <p className="text-muted-foreground">{i.motivo}</p>
              <p>{i.recomendacao}</p>
              <Link to={DESTINO_INSIGHT[i.tipo]} className="type-aux text-primary hover:underline">Ver detalhes →</Link>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export function InteligenciaOperacional({ resultado, carregando }: { resultado: ResultadoIntegracao | null; carregando: boolean }) {
  const [verInsuf, setVerInsuf] = useState(false);
  return (
    <section className="border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b">
        <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4" /><h2 className="type-section">Inteligência Operacional</h2></div>
        {resultado?.ok && <span className="type-aux">{resultado.acionaveis.length} EPIs com tendências</span>}
      </div>
      {carregando || !resultado ? (
        <p className="px-4 py-6 type-aux">Analisando histórico de entregas…</p>
      ) : !resultado.ok ? (
        <p className="px-4 py-6 text-sm text-destructive">Não foi possível gerar a análise agora. O restante da Central segue normal.</p>
      ) : resultado.total === 0 ? (
        <p className="px-4 py-6 type-aux">Nenhuma tendência relevante nas entregas dos últimos 365 dias.</p>
      ) : (
        <>
          {resultado.acionaveis.length > 0
            ? <ul>{resultado.acionaveis.map((g) => <Card key={g.chave} g={g} />)}</ul>
            : <p className="px-4 py-4 type-aux">Nenhuma tendência acionável no momento.</p>}
          {resultado.insuficientes.length > 0 && (
            <div className="border-t">
              <Button variant="ghost" type="button" onClick={() => setVerInsuf((v) => !v)} className="h-auto w-full justify-start whitespace-normal px-4 py-3 text-left type-aux hover:bg-muted/40">
                {verInsuf ? "Ocultar" : "Ver"} {resultado.insuficientes.length} itens com dados insuficientes
              </Button>
              {verInsuf && <ul>{resultado.insuficientes.map((g) => <Card key={g.chave} g={g} />)}</ul>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
