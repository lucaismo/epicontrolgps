import type { ComponentType, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SEM_CONSUMO_LABEL, type NivelEstoque, type Prioridade } from "@/lib/estoque-calc";

export type MetricTone = "neutral" | "danger" | "warning" | "success" | "muted";

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: "text-foreground",
  danger: "text-destructive",
  warning: "text-warning",
  success: "text-success",
  muted: "text-muted-foreground",
};

export const NIVEL_TONE: Record<NivelEstoque, MetricTone> = {
  zerado: "danger", critico: "danger", atencao: "warning", normal: "neutral",
};

export const PRIORIDADE_TONE: Record<Prioridade, MetricTone> = { alta: "danger", media: "warning", baixa: "success" };
export const PRIORIDADE_LABEL: Record<Prioridade, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

export const fmtNum = (v: number, dec = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Número operacional em destaque + unidade + linhas secundárias com hierarquia tipográfica. */
export function MetricValue({ value, unit, sub, tone = "neutral", size = "md", align = "left", className }: {
  value: ReactNode; unit?: string; sub?: ReactNode; tone?: MetricTone;
  size?: "sm" | "md" | "lg"; align?: "left" | "right"; className?: string;
}) {
  const sizeCls = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <div className={cn("leading-tight", align === "right" && "text-right", className)}>
      <div className={cn("font-semibold tabular-nums tracking-tight", sizeCls, TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
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
  const cls: Record<Prioridade, string> = {
    alta: "bg-destructive/10 text-destructive border-destructive/30",
    media: "bg-warning/15 text-warning border-warning/40",
    baixa: "bg-success/15 text-success border-success/30",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", cls[prioridade])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {PRIORIDADE_LABEL[prioridade]}
    </span>
  );
}

/** Indicador de topo (faixa operacional): número grande com rótulo, sem caixa vazia. */
export function StatCard({ icon: Icon, label, value, hint, tone = "neutral", className }: {
  icon?: ComponentType<{ className?: string }>; label: string; value: ReactNode; hint?: string; tone?: MetricTone; className?: string;
}) {
  const border = tone === "danger" ? "border-destructive/40" : tone === "warning" ? "border-warning/50" : "";
  return (
    <Card className={cn("p-4 flex items-center gap-4", border, className)}>
      {Icon && (
        <div className={cn("h-10 w-10 shrink-0 rounded-md grid place-items-center",
          tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-warning/15 text-warning"
            : tone === "success" ? "bg-success/10 text-success" : "bg-muted text-foreground")}>
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <div className={cn("text-3xl font-bold tabular-nums tracking-tight leading-none", TONE_TEXT[tone])}>{value}</div>
        <div className="text-sm font-medium mt-1.5">{label}</div>
        {hint && <div className="text-xs text-muted-foreground truncate">{hint}</div>}
      </div>
    </Card>
  );
}
