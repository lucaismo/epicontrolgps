import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_epis",
  title: "Listar EPIs",
  description: "Lista os EPIs ativos com estoque atual, mínimo, categoria e tamanho. Filtro opcional por nome/categoria.",
  inputSchema: {
    query: z.string().trim().optional().describe("Filtro por nome ou categoria (contém)."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de itens (padrão 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    const sb = supabaseForUser(ctx);
    let q = sb.from("epis")
      .select("id,nome,categoria,tamanho,estoque_atual,estoque_minimo,custo_unitario,status")
      .eq("status", "ativo")
      .order("nome")
      .limit(limit ?? 50);
    if (query) q = q.or(`nome.ilike.%${query}%,categoria.ilike.%${query}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
