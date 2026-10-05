import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { Loader2, FlaskConical } from "lucide-react";
import { ReviewAuthProvider } from "@/lib/auth";
import { installReviewNetwork, uninstallReviewNetwork } from "@/review/mock-network";
import { REVIEW_USER_ID } from "@/review/fixtures";

export const Route = createFileRoute("/__review")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ambiente de Revisão — EPI Control" },
      { name: "description", content: "Revisão visual das telas do EPI Control com dados fictícios." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Ambiente de Revisão — EPI Control" },
      { property: "og:description", content: "Revisão visual com dados fictícios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReviewLayout,
});

const NAV = [
  { to: "/__review", label: "Central de Controle", exact: true },
  { to: "/__review/entregas", label: "Entregas" },
  { to: "/__review/inventario", label: "Inventário" },
  { to: "/__review/compras", label: "Compras" },
  { to: "/__review/consumo", label: "Consumo mensal" },
  { to: "/__review/colaboradores", label: "Colaboradores" },
  { to: "/__review/epis", label: "EPIs" },
  { to: "/__review/relatorios", label: "Relatórios" },
] as const;

function ReviewLayout() {
  // Instala o escudo de rede ANTES de qualquer tela filha montar (render síncrono, só no navegador).
  const [qc] = useState(() => {
    installReviewNetwork();
    return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  });
  useEffect(() => () => { uninstallReviewNetwork(); qc.clear(); }, [qc]);

  return (
    <QueryClientProvider client={qc}>
      <ReviewAuthProvider userId={REVIEW_USER_ID}>
        <div className="min-h-screen bg-background">
          <div className="sticky top-0 z-40 border-b bg-warning/15 backdrop-blur">
            <div className="flex flex-col gap-2 px-4 py-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2.5">
                <FlaskConical className="h-4 w-4 text-warning-ink" />
                <div>
                  <div className="text-xs font-bold tracking-widest text-warning-ink">AMBIENTE DE REVISÃO</div>
                  <div className="text-xs text-foreground/80">Dados fictícios. Nenhuma operação afeta o sistema real.</div>
                </div>
              </div>
              <nav className="flex gap-1 overflow-x-auto -mx-1 px-1" aria-label="Telas de revisão">
                {NAV.map((n) => (
                  <Link key={n.to} to={n.to} activeOptions={{ exact: "exact" in n }}
                    className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium text-foreground/80 hover:bg-background/60"
                    activeProps={{ className: "bg-background text-foreground shadow-sm" }}>
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
          <main className="mx-auto max-w-[1600px]">
            <Suspense fallback={<div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </ReviewAuthProvider>
    </QueryClientProvider>
  );
}
