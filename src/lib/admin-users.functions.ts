import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RoleSchema = z.enum(["admin", "tecnico", "almoxarife", "lider"]);

// Mapeia erros técnicos para mensagens amigáveis ao usuário final.
// Loga o erro técnico no servidor e devolve uma mensagem segura.
function friendlyError(e: unknown, fallback = "Não foi possível concluir a operação"): Error {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  console.error("[admin-users]", raw, e);
  const lower = raw.toLowerCase();
  if (lower.includes("already been registered") || lower.includes("already registered") || lower.includes("duplicate key")) {
    return new Error("Este email já está cadastrado");
  }
  if (lower.includes("password") && lower.includes("short")) {
    return new Error("Senha muito curta (mínimo 8 caracteres)");
  }
  if (lower.includes("invalid email")) return new Error("Email inválido");
  if (lower.includes("rate limit")) return new Error("Muitas tentativas, aguarde alguns instantes");
  if (lower.includes("not allowed") || lower.includes("permission")) {
    return new Error("Operação não permitida para o seu perfil");
  }
  return new Error(fallback);
}

function sanitizeNome(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 120);
}

async function assertCallerIsAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Apenas administradores podem executar esta ação");
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCallerIsAdmin(context.userId);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,nome,email,created_at").order("nome"),
      supabaseAdmin.from("user_roles").select("user_id,role"),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    return (profiles ?? []).map((p: any) => ({ ...p, roles: roleMap.get(p.id) ?? [] }));
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      email: z.string().email().max(255),
      password: z.string().min(8).max(128),
      nome: z.string().min(2).max(120),
      role: RoleSchema,
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertCallerIsAdmin(context.userId);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;
    // Remove qualquer role default e atribui a escolhida pelo admin
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role });
    if (rErr) throw new Error(rErr.message);
    return { ok: true, id: uid };
  });

export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), role: RoleSchema }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertCallerIsAdmin(context.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await assertCallerIsAdmin(context.userId);
    if (data.user_id === context.userId) throw new Error("Você não pode excluir a si mesmo");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hasAnyAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1);
  if (error) throw new Error(error.message);
  return { hasAdmin: (data?.length ?? 0) > 0 };
});
