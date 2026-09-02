import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, ArrowLeft, Eye, EyeOff } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";

const OTP_LENGTH = 8;

const searchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Sign in — Seller Hub" },
      {
        name: "description",
        content: "Sign in or create your seller account to manage your store.",
      },
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
            <p className="mt-1 text-sm text-slate-500">Please enter your details to continue.</p>
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
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/auth" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const signIn = supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      const { data, error } = await Promise.race([
        signIn,
        new Promise<{
          data: { user: null; session: null };
          error: Error;
        }>((resolve) =>
          window.setTimeout(
            () =>
              resolve({
                data: { user: null, session: null },
                error: new Error("Sign in timed out. Check your connection and try again."),
              }),
            8_000,
          ),
        ),
      ]);

      if (error) {
        toast.error(error.message);
        return;
      }
      if (!data.session) {
        toast.error("Supabase did not create a session. Please try again.");
        return;
      }

      toast.success("Signed in");
      await navigate({ to: (redirect as any) || "/seller", replace: true });
    } catch (error) {
      console.error("[auth] seller sign in failed", error);
      toast.error(error instanceof Error ? error.message : "Sign in failed. Please try again.");
    } finally {
      setBusy(false);
    }
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
        <div className="relative">
          <Input
            id="si-pw"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
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
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return toast.error("Enter your email address");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        data: { display_name: displayName || email.trim().split("@")[0] },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setOtpSent(true);
    toast.success(`Verification code sent to ${email.trim()}`);
  }

  async function verifyAndCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code.trim())) {
      return toast.error(`Enter the ${OTP_LENGTH}-digit verification code`);
    }
    setBusy(true);
    const verification = supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    const { data, error } = await Promise.race([
      verification,
      new Promise<{ data: { session: null }; error: Error }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              data: { session: null },
              error: new Error(
                "Signup timed out. Check the deployed Supabase environment variables.",
              ),
            }),
          10000,
        ),
      ),
    ]);
    if (error) {
      setBusy(false);
      const msg = /weak|pwned|breach/i.test(error.message)
        ? "That password appears in known data breaches. Please choose a stronger, unique password."
        : error.message;
      return toast.error(msg);
    }
    if (!data.session) {
      setBusy(false);
      return toast.error("Verification completed, but no Supabase session was created.");
    }

    const { error: passwordError } = await supabase.auth.updateUser({
      password,
      data: { display_name: displayName || email.trim().split("@")[0] },
    });
    if (passwordError) {
      setBusy(false);
      return toast.error(passwordError.message);
    }
    setBusy(false);
    setOtpSent(false);
    setCode("");
    setPassword("");
    toast.success("Account created. Opening Seller Hub…");
  }

  if (otpSent) {
    return (
      <form onSubmit={verifyAndCreate} className="space-y-4 animate-fade-in">
        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-xs">
          We sent an {OTP_LENGTH}-digit verification code to{" "}
          <span className="font-medium">{email}</span>. Check your inbox or spam folder.
        </div>
        <div>
          <Label htmlFor="otp">Verification code</Label>
          <Input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder={`${OTP_LENGTH}-digit code`}
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => {
              setOtpSent(false);
              setCode("");
            }}
          >
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={busy || code.length !== OTP_LENGTH}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify & create
          </Button>
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => {
            void supabase.auth
              .signInWithOtp({
                email: email.trim(),
                options: {
                  shouldCreateUser: true,
                  data: { display_name: displayName || email.trim().split("@")[0] },
                },
              })
              .then(({ error }) => {
                if (error) toast.error(error.message);
                else toast.success("A new verification code was sent.");
              });
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
        <div className="relative">
          <Input
            id="su-pw"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
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
