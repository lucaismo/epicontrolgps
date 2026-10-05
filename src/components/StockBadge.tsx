import { NIVEL_LABEL, nivelEstoque } from "@/lib/estoque-calc";
import { NIVEL_TONE, TONE_STATUS } from "@/components/metrics";
import { cn } from "@/lib/utils";

export function StockBadge({ atual, minimo, compact }: { atual: number; minimo: number; compact?: boolean }) {
  const nivel = nivelEstoque(atual, minimo);
  // "Crítico" e "Zerado" usam a mesma semântica vermelha (severidade alta) em todo o sistema.
  const status = TONE_STATUS[NIVEL_TONE[nivel] === "neutral" ? "success" : NIVEL_TONE[nivel]];
  return (
    <div className={compact ? "" : "text-right"}>
      <div className={cn("status-pill", status)}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" /> {NIVEL_LABEL[nivel]}
      </div>
      {!compact && <div className="type-aux num mt-1">{atual} / mín {minimo}</div>}
    </div>
  );
}
