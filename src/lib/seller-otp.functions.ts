import { createServerFn } from "@tanstack/react-start";

const emailOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const sendSellerEmailOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; email: string }) => {
    if (!d?.accessToken || !emailOk(d.email)) throw new Error("Invalid verification request");
    return { accessToken: d.accessToken, email: d.email.trim().toLowerCase() };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (authError || !auth.user || auth.user.email?.toLowerCase() !== data.email)
      throw new Error("Session/email mismatch");

    const { error } = await supabaseAdmin.auth.signInWithOtp({
      email: data.email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      throw new Error(error.message);
    }
    return { sent: true };
  });

export const verifySellerEmailOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; email: string; code: string }) => {
    if (!d?.accessToken || !emailOk(d.email) || !d.code)
      throw new Error("Invalid verification request");
    return { accessToken: d.accessToken, email: d.email.trim().toLowerCase(), code: d.code.trim() };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (authError || !auth.user || auth.user.email?.toLowerCase() !== data.email)
      throw new Error("Session/email mismatch");

    let { error } = await supabaseAdmin.auth.verifyOtp({
      email: data.email,
      token: data.code,
      type: "email",
    });
    if (error) {
      const resMagic = await supabaseAdmin.auth.verifyOtp({
        email: data.email,
        token: data.code,
        type: "magiclink",
      });
      if (!resMagic.error) error = null;
    }
    if (error) {
      throw new Error(error.message || "Invalid or expired verification code");
    }
    return { verified: true };
  });
