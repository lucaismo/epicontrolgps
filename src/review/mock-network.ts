/**
 * Escudo de rede do Ambiente de Revisão.
 * Enquanto instalado, TODA requisição destinada ao backend é respondida
 * localmente com dados fictícios — nada sai do navegador. Gravações são
 * recusadas com uma mensagem clara. Só atua enquanto a URL está em /__review.
 */
import { TABLES, profiles } from "./fixtures";

const BACKEND_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
const BLOCK_MSG = "Ambiente de revisão: operação não executada (dados fictícios).";

let original: typeof fetch | null = null;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...headers },
  });
}

function getPath(obj: any, key: string) {
  return obj?.[key];
}

function matches(row: any, key: string, raw: string): boolean {
  const neg = raw.startsWith("not.");
  const expr = neg ? raw.slice(4) : raw;
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  const v = getPath(row, key);
  let ok = true;
  switch (op) {
    case "eq": ok = String(v) === val; break;
    case "neq": ok = String(v) !== val; break;
    case "gt": ok = v != null && String(v) > val; break;
    case "gte": ok = v != null && String(v) >= val; break;
    case "lt": ok = v != null && String(v) < val; break;
    case "lte": ok = v != null && String(v) <= val; break;
    case "is": ok = val === "null" ? v == null : String(v) === val; break;
    case "in": ok = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/"/g, "")).includes(String(v)); break;
    case "ilike": case "like": {
      const re = new RegExp("^" + val.replace(/[%*]/g, ".*") + "$", "i");
      ok = re.test(String(v ?? ""));
      break;
    }
    default: ok = true;
  }
  return neg ? !ok : ok;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function handleRest(url: URL, init: RequestInit | undefined, req: Request | null): Response {
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? req?.headers);
  const path = url.pathname.replace(/^\/rest\/v1\//, "");

  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    if (fn === "nomes_responsaveis") return json(profiles.map((p) => ({ id: p.id, nome: p.nome })));
    if (fn === "has_role") return json(true);
    return json({ message: BLOCK_MSG, code: "REVIEW" }, 400);
  }
  if (method !== "GET" && method !== "HEAD") {
    return json({ message: BLOCK_MSG, code: "REVIEW" }, 400);
  }

  let rows = [...(TABLES[path] ?? [])];
  url.searchParams.forEach((raw, key) => {
    if (RESERVED.has(key) || key === "or" || key === "and") return;
    rows = rows.filter((r) => matches(r, key, raw));
  });
  const order = url.searchParams.get("order");
  if (order) {
    const specs = order.split(",").map((s) => { const [c, dir] = s.split("."); return { c, desc: dir === "desc" }; });
    rows.sort((a, b) => {
      for (const { c, desc } of specs) {
        const x = a[c], y = b[c];
        if (x === y) continue;
        const r = x == null ? 1 : y == null ? -1 : x < y ? -1 : 1;
        return desc ? -r : r;
      }
      return 0;
    });
  }
  const total = rows.length;
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = url.searchParams.get("limit");
  let page = rows.slice(offset, limit ? offset + Number(limit) : undefined);
  const range = headers.get("range");
  if (range) { const [a, b] = range.split("-").map(Number); page = rows.slice(a, b + 1); }

  const crHeader = { "content-range": `${page.length ? offset : "*"}-${offset + Math.max(0, page.length - 1)}/${total}` };
  if (method === "HEAD") return new Response(null, { status: 200, headers: crHeader });
  if ((headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
    if (page.length === 0) return json({ message: "no rows", code: "PGRST116" }, 406);
    return json(page[0], 200, crHeader);
  }
  return json(page, 200, crHeader);
}

function handleAuth(url: URL): Response {
  // Sem sessão: o ambiente de revisão nunca se autentica no backend.
  if (url.pathname.endsWith("/user")) return json({ message: "review mode" }, 401);
  return json({ message: BLOCK_MSG }, 400);
}

export function installReviewNetwork() {
  if (typeof window === "undefined" || original) return;
  original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Só atua dentro de /__review; fora dele, a rede segue intacta para o sistema real.
    if (!window.location.pathname.startsWith("/__review")) return original!(input as any, init);
    const req = input instanceof Request ? input : null;
    const href = req ? req.url : String(input);
    const url = new URL(href, window.location.origin);
    const isBackend = BACKEND_URL && href.startsWith(BACKEND_URL);
    const isServerFn = url.origin === window.location.origin && url.pathname.startsWith("/_serverFn");
    if (isServerFn) return json({ message: BLOCK_MSG }, 400);
    if (!isBackend) return original!(input as any, init);
    if (url.pathname.startsWith("/rest/v1/")) return handleRest(url, init, req);
    if (url.pathname.startsWith("/auth/v1/")) return handleAuth(url);
    return json({ message: BLOCK_MSG }, 400); // storage, functions, realtime etc.
  };
}

export function uninstallReviewNetwork() {
  if (typeof window === "undefined" || !original) return;
  window.fetch = original;
  original = null;
}
