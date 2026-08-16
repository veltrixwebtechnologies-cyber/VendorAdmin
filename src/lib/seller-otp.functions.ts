import { createServerFn } from "@tanstack/react-start";
import { createHash, randomInt } from "crypto";

const hash = (email: string, code: string) =>
  createHash("sha256").update(`${email}:${code}`).digest("hex");
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
    const { data: allowed, error: limitError } = await supabaseAdmin.rpc(
      "consume_seller_otp_rate_limit",
      { _account_key: auth.user.id },
    );
    if (limitError || allowed !== true)
      throw new Error("Too many verification requests. Try again later.");
    const otpTable = supabaseAdmin.from("seller_verification_otps" as any) as any;
    const { data: recent } = await otpTable
      .select("created_at")
      .eq("user_id", auth.user.id)
      .eq("email", data.email)
      .maybeSingle();
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000)
      throw new Error("Please wait before requesting another code");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await otpTable.upsert(
      {
        user_id: auth.user.id,
        email: data.email,
        code_hash: hash(data.email, code),
        attempts: 0,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      { onConflict: "user_id,email" },
    );
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("Email verification is not configured");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.SELLER_OTP_FROM ?? "Local Shore <onboarding@resend.dev>",
        to: [data.email],
        subject: "Local Shore seller verification code",
        text: `Your seller verification code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!response.ok) throw new Error("Could not send verification code");
    return { sent: true };
  });

export const verifySellerEmailOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; email: string; code: string }) => {
    if (!d?.accessToken || !emailOk(d.email) || !/^\d{6}$/.test(d.code))
      throw new Error("Invalid verification request");
    return { accessToken: d.accessToken, email: d.email.trim().toLowerCase(), code: d.code };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (authError || !auth.user || auth.user.email?.toLowerCase() !== data.email)
      throw new Error("Session/email mismatch");
    const otpTable = supabaseAdmin.from("seller_verification_otps" as any) as any;
    const { data: row } = await otpTable
      .select("id,code_hash,attempts,expires_at")
      .eq("user_id", auth.user.id)
      .eq("email", data.email)
      .maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= 5)
      throw new Error("Code expired or locked");
    if (hash(data.email, data.code) !== row.code_hash) {
      await otpTable.update({ attempts: row.attempts + 1 }).eq("id", row.id);
      throw new Error("Invalid verification code");
    }
    await otpTable.delete().eq("id", row.id);
    return { verified: true };
  });
