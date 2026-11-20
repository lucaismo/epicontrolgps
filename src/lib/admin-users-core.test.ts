// @ts-nocheck -- executado com "bun test"
import { describe, it, expect, mock } from "bun:test";
const vi = { fn: mock };
import { createUserWithRole, friendlyMessage, RollbackFailedError, isSessionError } from "./admin-users-core";

const input = { email: "a@b.com", password: "12345678", nome: "Teste", role: "lider" as const };
const deps = (o: Partial<Parameters<typeof createUserWithRole>[0]> = {}) => ({
  createAuthUser: vi.fn(async () => ({ id: "new-uid" })),
  assignRole: vi.fn(async () => {}),
  deleteAuthUser: vi.fn(async () => {}),
  log: vi.fn(),
  ...o,
});

describe("createUserWithRole", () => {
  it("cria e atribui perfil com sucesso", async () => {
    const d = deps();
    await expect(createUserWithRole(d, input)).resolves.toEqual({ id: "new-uid" });
    expect(d.assignRole).toHaveBeenCalledWith("new-uid", "lider");
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
  });
  it("email duplicado: não exclui ninguém", async () => {
    const d = deps({ createAuthUser: vi.fn(async () => { throw new Error("User already been registered"); }) });
    await expect(createUserWithRole(d, input)).rejects.toThrow("already");
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(friendlyMessage(new Error("A user with this email address has already been registered"))).toBe("Este email já está cadastrado");
  });
  it("falha na atribuição: exclui só o UID recém-criado e propaga erro original", async () => {
    const orig = new Error("insert failed");
    const d = deps({ assignRole: vi.fn(async () => { throw orig; }) });
    await expect(createUserWithRole(d, input)).rejects.toBe(orig);
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(d.deleteAuthUser).toHaveBeenCalledWith("new-uid");
  });
  it("falha no rollback: erro dedicado com os dois erros registrados", async () => {
    const d = deps({
      assignRole: vi.fn(async () => { throw new Error("orig"); }),
      deleteAuthUser: vi.fn(async () => { throw new Error("rb"); }),
    });
    const err = await createUserWithRole(d, input).catch((e) => e);
    expect(err).toBeInstanceOf(RollbackFailedError);
    expect((err as RollbackFailedError).uid).toBe("new-uid");
    expect(d.log).toHaveBeenCalledTimes(2);
  });
  it("sem UID retornado: não atribui nem exclui", async () => {
    const d = deps({ createAuthUser: vi.fn(async () => ({ id: "" })) });
    await expect(createUserWithRole(d, input)).rejects.toThrow();
    expect(d.assignRole).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe("friendlyMessage", () => {
  it("sessão expirada", () => {
    expect(isSessionError(new Error("Unauthorized: Invalid token"))).toBe(true);
  });
  it("sem autorização administrativa", () => {
    expect(friendlyMessage(new Error("Apenas administradores podem executar esta ação"))).toBe("Apenas administradores podem executar esta ação");
  });
  it("não vaza erro técnico desconhecido", () => {
    expect(friendlyMessage(new Error("pg: relation xyz at 10.0.0.1"), "Erro ao criar usuário")).toBe("Erro ao criar usuário");
  });
});
