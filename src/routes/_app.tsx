import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
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

  // Só redireciona em transição real logado→deslogado. Sem este guard,
  // o user=null transitório durante a hidratação do supabase (entre
  // INITIAL_SESSION e SIGNED_IN) disparava window.location.replace("/login")
  // logo após o login bem-sucedido, gerando o loop login→dashboard→login.
  const wasAuthenticatedRef = useRef(false);
  useEffect(() => {
    if (user) {
      wasAuthenticatedRef.current = true;
      return;
    }
    if (!loading && roleLoaded && !user && wasAuthenticatedRef.current) {
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

