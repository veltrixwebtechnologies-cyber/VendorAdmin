import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

const emailOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const sendPasswordReset = createServerFn({ method: "POST" })
  .validator((data: { email: string; redirectTo: string }) => {
    if (!data?.email || !emailOk(data.email)) throw new Error("Enter a valid email address");
    if (!data.redirectTo) throw new Error("Missing password reset redirect URL");
    return { email: data.email.trim().toLowerCase(), redirectTo: data.redirectTo };
  })
  .handler(async ({ data }) => {
    const runtimeEnv = typeof process !== "undefined" ? process.env : undefined;
    const supabaseUrl = runtimeEnv?.SUPABASE_URL;
    const publishableKey = runtimeEnv?.SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !publishableKey) {
      throw new Error("Supabase server authentication is not configured");
    }

    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: data.redirectTo,
    });
    if (error) throw new Error(error.message);
    return { sent: true };
  });
