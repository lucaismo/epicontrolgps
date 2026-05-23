import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
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
  const { loading, user } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    supabase.auth.signOut().finally(() => {
      window.location.replace("/login");
    });
    return null;
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
