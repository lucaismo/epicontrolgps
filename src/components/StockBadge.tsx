import { NIVEL_CLASS, NIVEL_LABEL, nivelEstoque } from "@/lib/estoque-calc";

export function StockBadge({ atual, minimo, compact }: { atual: number; minimo: number; compact?: boolean }) {
  const nivel = nivelEstoque(atual, minimo);
  return (
    <div className={compact ? "" : "text-right"}>
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${NIVEL_CLASS[nivel]}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" /> {NIVEL_LABEL[nivel]}
      </div>
      {!compact && <div className="text-xs text-muted-foreground mt-1">{atual} / mín {minimo}</div>}
    </div>
  );
}
