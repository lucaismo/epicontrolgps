import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listEpis from "./tools/list-epis";
import listColaboradores from "./tools/list-colaboradores";
import listMovimentacoes from "./tools/list-movimentacoes";
import stockSummary from "./tools/stock-summary";

// OAuth issuer MUST be the direct Supabase host — never the .lovable.cloud proxy.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "epi-control-mcp",
  title: "EPI Control MCP",
  version: "0.1.0",
  instructions:
    "Ferramentas para consultar o sistema EPI Control (gestão de EPIs, colaboradores e movimentações de estoque). Todas as consultas respeitam as permissões do usuário autenticado (RLS).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listEpis, listColaboradores, listMovimentacoes, stockSummary],
});
