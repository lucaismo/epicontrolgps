// Lógica pura do cadastro de usuários (sem dependências do servidor) para permitir testes.

export type RoleValue = "admin" | "tecnico" | "almoxarife" | "lider";

export interface CreateUserDeps {
  createAuthUser: (input: { email: string; password: string; nome: string }) => Promise<{ id: string }>;
  assignRole: (uid: string, role: RoleValue) => Promise<void>;
  deleteAuthUser: (uid: string) => Promise<void>;
  log?: (msg: string, err: unknown) => void;
}

export class RollbackFailedError extends Error {
  constructor(public original: unknown, public rollback: unknown, public uid: string) {
    super(
      "O usuário foi criado, mas não foi possível atribuir o perfil nem desfazer o cadastro. Avise o suporte antes de tentar novamente.",
    );
    this.name = "RollbackFailedError";
  }
}

/**
 * Cria o usuário e atribui o perfil. Se a atribuição falhar, remove SOMENTE o
 * UID recém-criado (o perfil em `profiles` cai junto via ON DELETE CASCADE).
 * Se a criação falhar, nada é excluído.
 */
export async function createUserWithRole(
  deps: CreateUserDeps,
  input: { email: string; password: string; nome: string; role: RoleValue },
): Promise<{ id: string }> {
  const log = deps.log ?? ((m, e) => console.error(m, e));
  const created = await deps.createAuthUser({ email: input.email, password: input.password, nome: input.nome });
  const uid = created?.id;
  if (!uid) throw new Error("Falha ao criar usuário: identificador não retornado");
  try {
    await deps.assignRole(uid, input.role);
    return { id: uid };
  } catch (original) {
    log("[admin-users] falha ao atribuir perfil; desfazendo cadastro de " + uid, original);
    try {
      await deps.deleteAuthUser(uid);
    } catch (rollback) {
      log("[admin-users] FALHA NO ROLLBACK do usuário " + uid, rollback);
      throw new RollbackFailedError(original, rollback, uid);
    }
    throw original;
  }
}

/** Converte erros técnicos em mensagens seguras para o administrador. */
export function friendlyMessage(e: unknown, fallback = "Não foi possível concluir a operação"): string {
  if (e instanceof RollbackFailedError) return e.message;
  const raw = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as any).message) : String(e ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("jwt") || lower.includes("invalid token"))
    return "Sua sessão expirou. Entre novamente para continuar.";
  if (lower.includes("apenas administradores")) return "Apenas administradores podem executar esta ação";
  if (lower.includes("already been registered") || lower.includes("already registered") || lower.includes("duplicate key"))
    return "Este email já está cadastrado";
  if (lower.includes("password") && (lower.includes("short") || lower.includes("at least")))
    return "Senha muito curta (mínimo 8 caracteres)";
  if (lower.includes("invalid email") || lower.includes("invalid_string")) return "Email inválido";
  if (lower.includes("rate limit")) return "Muitas tentativas, aguarde alguns instantes";
  if (lower.includes("not allowed") || lower.includes("permission")) return "Operação não permitida para o seu perfil";
  return fallback;
}

export function isSessionError(e: unknown): boolean {
  return friendlyMessage(e) === "Sua sessão expirou. Entre novamente para continuar.";
}
