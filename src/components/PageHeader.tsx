import type { ComponentType, ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  /** Informação de contexto: período, atualização, contagens — abaixo do título. */
  meta?: ReactNode;
  /** Ações e controles no canto direito (filtros, botões). */
  actions?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
};

/**
 * Cabeçalho padrão de página.
 * Estrutura fixa: título (type-page), subtítulo (type-aux), meta opcional,
 * ações alinhadas à direita. Empilha em telas estreitas.
 */
export function PageHeader({ title, subtitle, meta, actions, icon: Icon }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <Icon className="h-4.5 w-4.5" />
            </span>
          )}
          <h1 className="type-page text-foreground">{title}</h1>
        </div>
        {subtitle && <p className="type-aux mt-1.5 max-w-2xl">{subtitle}</p>}
        {meta && <div className="type-label mt-2">{meta}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end md:pt-1">
          {actions}
        </div>
      )}
    </header>
  );
}
