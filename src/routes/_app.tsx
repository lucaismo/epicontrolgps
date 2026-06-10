import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
  },
  component: AppShell,
});

function AppShell() {
  return (
    <AuthProvider>
      <AppGuard />
    </AuthProvider>
  );
}

function AppGuard() {
  const { loading, user, role, roleLoaded } = useAuth();

  // Redireciona via efeito — nunca durante o render. Side-effects em render
  // disparavam signOut() em estados transitórios (user=null momentâneo),
  // produzindo o loop login → dashboard → login.
  useEffect(() => {
    if (!loading && roleLoaded && !user) {
      window.location.replace("/login");
    }
  }, [loading, roleLoaded, user]);

  if (loading || !roleLoaded || (user && !roleLoaded)) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // M14: usuário autenticado sem perfil atribuído fica bloqueado aguardando o admin.
  if (!role) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Aguardando liberação</h1>
          <p className="text-sm text-muted-foreground">
            Sua conta foi criada, mas ainda não tem um perfil de acesso atribuído.
            Solicite ao administrador a definição do seu perfil para entrar no sistema.
          </p>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.replace("/login"))}
            className="text-sm underline text-primary"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

