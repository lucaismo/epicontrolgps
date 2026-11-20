import { createStart, createMiddleware } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

import { renderErrorPage } from "./lib/error-page";

const SERVER_FN_BASE = "/_serverFn/";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    // Chamadas RPC de server functions: deixar o TanStack Start serializar o erro
    // no protocolo esperado pelo cliente (não converter em página HTML).
    const base = process.env.TSS_SERVER_FN_BASE || SERVER_FN_BASE;
    if (new URL(request.url).pathname.includes(base)) throw error;
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
