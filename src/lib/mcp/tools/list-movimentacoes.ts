import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_movimentacoes",
  title: "Últimas movimentações",
  description: "Lista movimentações de estoque (entregas, devoluções, ajustes, entradas) mais recentes, com filtros opcionais por tipo e período.",
  inputSchema: {
    tipo: z.enum([
      "entrega", "devolucao_normal", "avariado", "descarte", "troca",
      "perda", "roubo", "entrada_estoque", "ajuste_entrada", "ajuste_saida",
    ]).optional().describe("Filtro por tipo de movimentação."),
    since: z.string().optional().describe("Data ISO mínima (data_movimentacao >= since)."),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tipo, since, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    const sb = supabaseForUser(ctx);
    let q = sb.from("movimentacoes")
      .select("id,tipo,quantidade,motivo,observacao,data_movimentacao,epis(nome,categoria),colaboradores(nome,matricula)")
      .order("data_movimentacao", { ascending: false })
      .limit(limit ?? 25);
    if (tipo) q = q.eq("tipo", tipo);
    if (since) q = q.gte("data_movimentacao", since);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
