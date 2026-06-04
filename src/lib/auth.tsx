import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "tecnico" | "almoxarife" | "lider";

interface AuthState {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  roleLoaded: boolean;
  signOut: () => Promise<void>;
}


const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoaded, setRoleLoaded] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setRoleLoaded(false);
        setTimeout(() => { fetchRole(newSession.user.id); }, 0);
      } else {
        setRole(null);
        setRoleLoaded(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchRole(s.user.id);
      else setRoleLoaded(true);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchRole(uid: string) {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .order("role", { ascending: true })
      .limit(1)
      .maybeSingle();
    // M14: usuário sem role atribuída NÃO recebe acesso automático.
    setRole((data?.role as AppRole) ?? null);
    setRoleLoaded(true);
  }


  async function signOut() {
    await supabase.auth.signOut();
    setRole(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, role, loading, roleLoaded, signOut }}>

      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function canManageRegistros(role: AppRole | null) {
  return role === "admin" || role === "tecnico";
}
export function canMovimentar(role: AppRole | null) {
  return role === "admin" || role === "tecnico" || role === "almoxarife";
}
