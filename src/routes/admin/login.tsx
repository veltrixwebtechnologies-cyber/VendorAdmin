import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ShieldCheck, Loader2, Eye, EyeOff } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useAdminAccess } from "@/shared/auth/admin-permissions";
import { sendPasswordReset } from "@/lib/password-reset.functions";

const searchSchema = z.object({
  reset: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/admin/login")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Admin Login — LocalShore" },
      { name: "description", content: "Restricted admin console access." },
      { property: "og:title", content: "Admin Login — LocalShore" },
      { property: "og:description", content: "Restricted admin console access." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const { reset } = useSearch({ from: "/admin/login" });
  const { user } = useAuth();
  const isAdminQ = useAdminAccess();

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);

  useEffect(() => {
    if (reset !== "1" && user && isAdminQ.data) navigate({ to: "/admin", replace: true });
  }, [reset, user, isAdminQ.data, navigate]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await Promise.race([
        supabase.auth.signInWithPassword({
          email: email.trim(),
          password: pass,
        }),
        new Promise<{
          data: { user: null; session: null };
          error: Error;
        }>((resolve) =>
          window.setTimeout(
            () =>
              resolve({
                data: { user: null, session: null },
                error: new Error("Admin sign in timed out. Check your connection and try again."),
              }),
            8_000,
          ),
        ),
      ]);
      if (error) {
        toast.error(error.message);
        return;
      }

      const uid = data.user?.id;
      if (!uid || !data.session) {
        toast.error("Supabase did not create an admin session.");
        return;
      }

      const { data: access, error: accessError } = await Promise.race([
        (supabase as any).rpc("get_my_admin_access"),
        new Promise<{ data: null; error: Error }>((resolve) =>
          window.setTimeout(
            () =>
              resolve({
                data: null,
                error: new Error("Admin role verification timed out. Please try again."),
              }),
            8_000,
          ),
        ),
      ]);

      // Existing admins keep access during rollout before the migration is applied.
      let isAdmin = !accessError && access?.status === "active";
      if (accessError && (accessError.code === "PGRST202" || accessError.code === "42883")) {
        const legacy = await (supabase as any)
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .eq("role", "admin")
          .eq("status", "active")
          .maybeSingle();
        if (legacy.error) throw legacy.error;
        isAdmin = Boolean(legacy.data);
      } else if (accessError) {
        throw accessError;
      }

      if (isAdmin) {
        await isAdminQ.refetch();
        toast.success("Signed in as admin");
        await navigate({ to: "/admin", replace: true });
        return;
      }

      await supabase.auth.signOut();
      toast.error("This account does not have admin access.");
    } catch (error) {
      console.error("[auth] admin sign in failed", error);
      toast.error(
        error instanceof Error ? error.message : "Admin sign in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSendReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Enter your admin email address first.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await sendPasswordReset({
        data: {
          email: email.trim(),
          redirectTo: `${window.location.origin}/admin/reset`,
        },
      });
      toast.success("Password reset link sent. Check your inbox or spam folder.");
      setForgotPassword(false);
    } catch (error) {
      console.error("[auth] admin password reset failed", error);
      toast.error(error instanceof Error ? error.message : "Could not send reset link.");
    } finally {
      setBusy(false);
    }
  }

  if (reset === "1") return <AdminPasswordResetForm />;

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

        {!user && forgotPassword ? (
          <form onSubmit={onSendReset} className="mt-6 space-y-4">
            <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-xs text-muted-foreground">
              Enter your admin account email and we’ll send a secure reset link back to the Admin
              Console.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-reset-email">Admin email</Label>
              <Input
                id="admin-reset-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send reset link
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setForgotPassword(false)}
            >
              Back to admin sign in
            </Button>
          </form>
        ) : !user ? (
          <form onSubmit={onLogin} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Admin email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pass">Password</Label>
              <div className="relative">
                <Input
                  id="pass"
                  type={showPass ? "text" : "password"}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs font-medium text-muted-foreground hover:text-primary hover:underline"
              onClick={() => setForgotPassword(true)}
            >
              Forgot password?
            </button>
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
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  This account does not have admin access. Ask an existing admin to grant you the
                  admin role.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setEmail("");
                    setPass("");
                  }}
                >
                  Sign out and use another account
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="story-link">
            ← Back to Seller Hub
          </Link>
        </div>
      </div>
    </div>
  );
}

function AdminPasswordResetForm() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (password !== confirmPassword) return toast.error("Passwords do not match.");
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Password updated. Sign in with your new password.");
      await navigate({ to: "/admin/login", replace: true });
    } catch (error) {
      console.error("[auth] admin password update failed", error);
      toast.error(error instanceof Error ? error.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm animate-fade-in">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Reset admin password</h1>
            <p className="text-xs text-muted-foreground">Admin Console</p>
          </div>
        </div>
        <form onSubmit={onUpdatePassword} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-new-password">New password</Label>
            <Input
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-confirm-password">Confirm new password</Label>
            <Input
              id="admin-confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
