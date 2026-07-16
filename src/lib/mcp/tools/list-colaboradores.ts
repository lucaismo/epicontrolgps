import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_colaboradores",
  title: "Listar colaboradores",
  description: "Lista colaboradores com matrícula, função e turno. Filtra por nome/matrícula e status (ativo/desligado).",
  inputSchema: {
    query: z.string().trim().optional().describe("Filtro por nome ou matrícula (contém)."),
    status: z.enum(["ativo", "desligado"]).optional().describe("Padrão: ativo."),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    const sb = supabaseForUser(ctx);
    let q = sb.from("colaboradores")
      .select("id,nome,matricula,funcao,turno,status,data_admissao")
      .eq("status", status ?? "ativo")
      .order("nome")
      .limit(limit ?? 50);
    if (query) q = q.or(`nome.ilike.%${query}%,matricula.ilike.%${query}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
