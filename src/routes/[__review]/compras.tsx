import { createFileRoute } from "@tanstack/react-router";
import { Route as Real } from "@/routes/_app/compras";

// Renderiza a tela REAL com os dados fictícios do Ambiente de Revisão.
const Screen = Real.options.component!;

export const Route = createFileRoute("/__review/compras")({ component: () => <Screen /> });
