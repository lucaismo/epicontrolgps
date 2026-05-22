import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({ component: ResetPassword });

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) toast.error(error.message);
    else { toast.success("Senha atualizada!"); window.location.href = "/dashboard"; }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-secondary">
      <Card className="p-6 w-full max-w-md">
        <h1 className="text-xl font-bold mb-1">Nova senha</h1>
        <p className="text-sm text-muted-foreground mb-5">Defina uma nova senha para sua conta</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw">Nova senha</Label>
            <Input id="pw" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>{loading ? "Salvando…" : "Atualizar senha"}</Button>
        </form>
      </Card>
    </div>
  );
}
