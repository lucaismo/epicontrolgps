import type { ComponentType, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SEM_CONSUMO_LABEL, type NivelEstoque, type Prioridade } from "@/lib/estoque-calc";

export type MetricTone = "neutral" | "danger" | "warning" | "success" | "muted";

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: "text-foreground",
  danger: "text-destructive",
  warning: "text-warning-ink",
  success: "text-success-ink",
  muted: "text-muted-foreground",
};

export const NIVEL_TONE: Record<NivelEstoque, MetricTone> = {
  zerado: "danger", critico: "danger", atencao: "warning", normal: "neutral",
};

export const PRIORIDADE_TONE: Record<Prioridade, MetricTone> = { alta: "danger", media: "warning", baixa: "success" };
export const PRIORIDADE_LABEL: Record<Prioridade, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

/** Classe semântica de estado (crítico/atenção/normal/neutro/sem consumo) por tom. */
export const TONE_STATUS: Record<MetricTone, string> = {
  danger: "status-critical", warning: "status-warning", success: "status-normal",
  neutral: "status-neutral", muted: "status-nodata",
};

export const fmtNum = (v: number, dec = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Número operacional em destaque + unidade + linhas secundárias com hierarquia tipográfica. */
export function MetricValue({ value, unit, sub, tone = "neutral", size = "md", align = "left", className }: {
  value: ReactNode; unit?: string; sub?: ReactNode; tone?: MetricTone;
  size?: "sm" | "md" | "lg"; align?: "left" | "right"; className?: string;
}) {
  const sizeCls = size === "lg" ? "type-kpi-sm" : size === "sm" ? "text-base font-semibold" : "text-lg font-semibold";
  return (
    <div className={cn("leading-tight", align === "right" && "text-right", className)}>
      <div className={cn("num tracking-tight", sizeCls, TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-1 text-xs font-medium tracking-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="type-aux num mt-0.5">{sub}</div>}
    </div>
  );
}

/** Célula "Estoque": quantidade em destaque, mínimo (calculado ou cadastrado) e trânsito como secundários. */
export function StockLevel({ atual, minimoCalc, minimoCadastrado, transito, nivel, align }: {
  atual: number; minimoCalc: number | null; minimoCadastrado: number; transito?: number;
  nivel: NivelEstoque; align?: "left" | "right";
}) {
  const sub = minimoCalc !== null
    ? `mínimo recomendado: ${minimoCalc}`
    : minimoCadastrado > 0 ? `mínimo cadastrado: ${minimoCadastrado}` : SEM_CONSUMO_LABEL;
  return (
    <MetricValue
      value={fmtNum(atual)} unit={atual === 1 ? "unidade" : "unidades"} tone={NIVEL_TONE[nivel]} align={align}
      sub={<>
        <span>{sub}</span>
        {transito ? <span className="block">em trânsito: +{transito}</span> : null}
      </>}
    />
  );
}

/** Célula "Cobertura": dias em destaque + previsão de ruptura. */
export function CoverageIndicator({ cobertura, ruptura, leadDias, align }: {
  cobertura: number; ruptura: Date | null; leadDias: number; align?: "left" | "right";
}) {
  if (!Number.isFinite(cobertura)) {
    return <MetricValue value="—" sub={SEM_CONSUMO_LABEL} tone="muted" align={align} />;
  }
  const dias = Math.floor(cobertura);
  const tone: MetricTone = dias < leadDias ? "danger" : dias < leadDias * 1.5 ? "warning" : "neutral";
  return (
    <MetricValue
      value={fmtNum(dias)} unit="dias" tone={tone} align={align}
      sub={ruptura ? `ruptura prevista: ${ruptura.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : undefined}
    />
  );
}

/** Célula "Consumo": mensal em destaque, diário como secundário. */
export function ConsumptionCell({ mensal, diario, align }: { mensal: number; diario: number; align?: "left" | "right" }) {
  if (!(diario > 0)) return <MetricValue value="—" sub={SEM_CONSUMO_LABEL} tone="muted" align={align} />;
  return <MetricValue value={fmtNum(mensal, 1)} unit="/mês" sub={`${fmtNum(diario, 2)}/dia`} align={align} />;
}

/** Selo compacto de prioridade (cor apenas para situação). */
export function PriorityBadge({ prioridade }: { prioridade: Prioridade }) {
  return (
    <span className={cn("status-pill", TONE_STATUS[PRIORIDADE_TONE[prioridade]])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {PRIORIDADE_LABEL[prioridade]}
    </span>
  );
}

/** Indicador de topo (faixa operacional): número grande com rótulo, sem caixa vazia. */
export function StatCard({ icon: Icon, label, value, hint, tone = "neutral", className }: {
  icon?: ComponentType<{ className?: string }>; label: string; value: ReactNode; hint?: string; tone?: MetricTone; className?: string;
}) {
  const accent = tone === "danger" ? "before:bg-destructive" : tone === "warning" ? "before:bg-warning"
    : tone === "success" ? "before:bg-success" : "before:bg-transparent";
  return (
    <Card className={cn("relative overflow-hidden rounded-lg p-4 flex items-center gap-4 shadow-none",
      "before:absolute before:inset-y-0 before:left-0 before:w-1", accent, className)}>
      {Icon && (
        <div className={cn("h-10 w-10 shrink-0 rounded-md grid place-items-center",
          tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-warning/15 text-warning-ink"
            : tone === "success" ? "bg-success/10 text-success-ink" : "bg-muted text-muted-foreground")}>
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <div className={cn("type-kpi num", TONE_TEXT[tone])}>{value}</div>
        <div className="text-sm font-medium mt-2 text-foreground/90">{label}</div>
        {hint && <div className="type-aux truncate">{hint}</div>}
      </div>
    </Card>
  );
}
