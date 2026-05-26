import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { hasAnyAdmin } from "@/lib/admin-users.functions";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const checkAdmin = useServerFn(hasAnyAdmin);
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [bootstrap, setBootstrap] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkAdmin().then((r) => setBootstrap(!r.hasAdmin)).catch(() => setBootstrap(false));
  }, [checkAdmin]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await navigate({ to: "/dashboard", replace: true });
      } else if (mode === "signup") {
        if (!bootstrap) throw new Error("Cadastro restrito — solicite ao administrador");
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { nome }, emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        toast.success("Conta de administrador criada! Faça login.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Email de recuperação enviado.");
        setMode("login");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-secondary via-secondary to-[oklch(0.21_0.03_264)]">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="h-14 w-14 rounded-xl bg-primary grid place-items-center mb-3 shadow-lg shadow-primary/30">
            <Shield className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-white">EPI Control</h1>
          <p className="text-sm text-white/60">Gestão de estoque e entrega de EPIs</p>
        </div>

        <Card className="p-6 shadow-xl">
          <h2 className="text-lg font-semibold mb-1">
            {mode === "login" ? "Entrar" : mode === "signup" ? "Cadastro inicial" : "Recuperar senha"}
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            {mode === "login"
              ? "Acesse o sistema com suas credenciais."
              : mode === "signup"
              ? "Apenas o primeiro acesso. Esta conta será o Administrador."
              : "Informe seu email para receber instruções."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="nome">Nome completo</Label>
                <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {mode !== "reset" && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "login" ? "Entrar" : mode === "signup" ? "Criar administrador" : "Enviar email"}
            </Button>
          </form>

          <div className="mt-5 flex justify-between text-xs text-muted-foreground">
            {mode === "login" ? (
              <>
                <button type="button" onClick={() => setMode("reset")} className="hover:text-primary">Esqueci a senha</button>
                {bootstrap && (
                  <button type="button" onClick={() => setMode("signup")} className="hover:text-primary">
                    Criar administrador
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={() => setMode("login")} className="hover:text-primary">Voltar ao login</button>
            )}
          </div>

          {!bootstrap && mode === "login" && (
            <p className="mt-4 text-[11px] text-muted-foreground border-t pt-3">
              Novos usuários são criados pelo administrador. Solicite acesso ao responsável.
            </p>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-white/40">
          Acesso restrito — uso interno empresarial
        </p>
      </div>
    </div>
  );
}
