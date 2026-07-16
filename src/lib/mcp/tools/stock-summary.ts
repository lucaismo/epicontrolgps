import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "stock_summary",
  title: "Resumo de estoque",
  description: "Retorna totais consolidados: quantidade de EPIs cadastrados, estoque total, EPIs abaixo do mínimo e zerados, com a lista dos críticos.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb.from("epis")
      .select("id,nome,categoria,estoque_atual,estoque_minimo")
      .eq("status", "ativo");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const epis = data ?? [];
    const abaixo = epis.filter((e) => e.estoque_atual < e.estoque_minimo);
    const zerados = epis.filter((e) => e.estoque_atual === 0);
    const summary = {
      total_epis: epis.length,
      estoque_total: epis.reduce((s, e) => s + (e.estoque_atual ?? 0), 0),
      abaixo_do_minimo: abaixo.length,
      zerados: zerados.length,
      criticos: abaixo.slice(0, 20),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
