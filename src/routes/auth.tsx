import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, ArrowLeft } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";

const searchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Sign in — Seller Hub" },
      { name: "description", content: "Sign in or create your seller account to manage your store." },
      { property: "og:title", content: "Sign in — Seller Hub" },
      { property: "og:description", content: "Sign in or create your seller account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/auth" });

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: (redirect as any) || "/seller", replace: true });
    }
  }, [user, loading, navigate, redirect]);

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      {/* Ambient background blobs */}
      <div className="pointer-events-none absolute -top-[10%] -left-[10%] h-[45%] w-[45%] rounded-full bg-teal-300/25 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-[10%] -right-[10%] h-[45%] w-[45%] rounded-full bg-primary/25 blur-[120px]" />

      <div className="relative z-10 w-full max-w-[440px] space-y-6 animate-fade-in-up">
        <Link
          to="/"
          className="group inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-teal-600"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          Back to home
        </Link>

        <div className="rounded-3xl border border-white bg-white/80 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl md:p-10">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-slate-900">Welcome</h1>
            <p className="mt-1 text-sm text-slate-500">
              Please enter your details to continue.
            </p>
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="mb-6 grid w-full grid-cols-2 rounded-xl bg-slate-100/70 p-1">
              <TabsTrigger
                value="signin"
                className="rounded-lg text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
              >
                Sign in
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="rounded-lg text-sm font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
              >
                Create account
              </TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="mt-0">
              <SignInForm />
            </TabsContent>
            <TabsContent value="signup" className="mt-0">
              <SignUpForm />
            </TabsContent>
          </Tabs>

          <p className="mt-8 text-center text-xs leading-relaxed text-slate-400">
            By continuing you agree to our{" "}
            <a href="#" className="font-medium text-slate-600 hover:underline">
              terms
            </a>{" "}
            &{" "}
            <a href="#" className="font-medium text-slate-600 hover:underline">
              privacy policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}


function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="si-email">Email</Label>
        <Input
          id="si-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="si-pw">Password</Label>
        <Input
          id="si-pw"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
      </Button>
    </form>
  );
}

function SignUpForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    const generated = String(Math.floor(100000 + Math.random() * 900000));
    setOtp(generated);
    toast.success(`Verification code sent to ${email}`);
    toast.info(`Simulated OTP: ${generated}`, { duration: 15000 });
  }

  async function verifyAndCreate(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim() !== otp) return toast.error("Incorrect verification code");
    setBusy(true);
    const signup = supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/seller`,
        data: { display_name: displayName || email.split("@")[0] },
      },
    });
    const { data, error } = await Promise.race([
      signup,
      new Promise<{ data: { session: null }; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null }, error: new Error("Signup timed out. Check the deployed Supabase environment variables.") }), 10000),
      ),
    ]);
    if (error) {
      setBusy(false);
      const msg = /weak|pwned|breach/i.test(error.message)
        ? "That password appears in known data breaches. Please choose a stronger, unique password."
        : error.message;
      return toast.error(msg);
    }
    // Supabase returns a session immediately when email confirmation is disabled.
    // When confirmation is enabled, do not make a second blocking login request.
    if (!data.session) {
      setBusy(false);
      setOtp(null);
      setCode("");
      setPassword("");
      return toast.success("Account created. Confirm your email, then sign in.");
    }
    setBusy(false);
    setOtp(null);
    setCode("");
    setPassword("");
    toast.success("Account created. Opening Seller Hub…");
  }

  if (otp) {
    return (
      <form onSubmit={verifyAndCreate} className="space-y-4 animate-fade-in">
        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-xs">
          We sent a 6-digit code to <span className="font-medium">{email}</span>. For this demo the
          code is shown on screen: <span className="font-mono font-semibold">{otp}</span>
        </div>
        <div>
          <Label htmlFor="otp">Verification code</Label>
          <Input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="6-digit code"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => { setOtp(null); setCode(""); }}>
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={busy || code.length !== 6}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify & create
          </Button>
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => {
            const g = String(Math.floor(100000 + Math.random() * 900000));
            setOtp(g);
            toast.info(`New code: ${g}`, { duration: 15000 });
          }}
        >
          Resend code
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="space-y-4">
      <div>
        <Label htmlFor="su-name">Display name</Label>
        <Input
          id="su-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Rhea's Store"
        />
      </div>
      <div>
        <Label htmlFor="su-email">Email</Label>
        <Input
          id="su-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="su-pw">Password</Label>
        <Input
          id="su-pw"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Minimum 8 characters. Avoid common passwords — we check against known breaches.
        </p>
      </div>
      <Button type="submit" className="w-full">
        Send verification code
      </Button>
    </form>
  );
}
