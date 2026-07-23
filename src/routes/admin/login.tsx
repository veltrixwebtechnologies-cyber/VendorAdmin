import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useClaimFirstAdmin, useHasAnyAdmin, useIsAdmin } from "@/lib/db";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "Admin Login — Seller Hub" },
      { name: "description", content: "Restricted admin console access." },
      { property: "og:title", content: "Admin Login — Seller Hub" },
      { property: "og:description", content: "Restricted admin console access." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdminQ = useIsAdmin();
  const hasAdminQ = useHasAnyAdmin();
  const claim = useClaimFirstAdmin();

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && isAdminQ.data) navigate({ to: "/admin", replace: true });
  }, [user, isAdminQ.data, navigate]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const uid = data.user?.id;
    // Verify admin role before granting access
    const [{ data: roleRow }, { data: anyAdmin }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid!).eq("role", "admin").maybeSingle(),
      supabase.rpc("has_any_admin"),
    ]);
    setBusy(false);
    if (roleRow) {
      toast.success("Signed in as admin");
      return;
    }
    // Not an admin. Allow only if no admin exists yet (first-time claim).
    if (!anyAdmin) {
      toast.message("Sign-in successful — claim admin to continue.");
      return;
    }
    await supabase.auth.signOut();
    toast.error("This account does not have admin access.");
  }

  async function onClaim() {
    const ok = await claim.mutateAsync();
    if (ok) {
      toast.success("You're now the admin");
    } else {
      toast.error("Admin already exists — ask them for access.");
    }
  }

  const canClaim = user && hasAdminQ.data === false && !isAdminQ.data;

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm animate-fade-in">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Admin Console</h1>
            <p className="text-xs text-muted-foreground">Restricted access</p>
          </div>
        </div>

        {!user ? (
          <form onSubmit={onLogin} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Admin email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pass">Password</Label>
              <Input id="pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Only accounts with admin access can enter this console.
            </p>
          </form>
        ) : (
          <div className="mt-6 space-y-4 text-sm">
            <div className="rounded-md border p-3 text-xs">
              Signed in as <span className="font-medium">{user.email}</span>
            </div>
            {isAdminQ.data ? (
              <Button className="w-full" onClick={() => navigate({ to: "/admin" })}>
                Enter admin console
              </Button>
            ) : canClaim ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  No admin exists yet. The first authorized setup account can claim admin access.
                </div>
                <Button className="w-full" onClick={onClaim} disabled={claim.isPending}>
                  {claim.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Claim admin
                </Button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                This account does not have admin access. Ask an existing admin to grant you the admin role.
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="story-link">← Back to Seller Hub</Link>
        </div>
      </div>
    </div>
  );
}
