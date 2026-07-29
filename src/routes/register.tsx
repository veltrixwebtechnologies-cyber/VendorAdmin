import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, FileUp, Loader2, MailCheck, Pencil, Send, ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { useAuth } from "@/lib/auth";
import {
  useMySeller, useSubmitMySeller, useUpdateMySeller, uploadSellerDoc,
  type Seller, type BusinessType, type SellerDocuments, type StoredFile,
} from "@/lib/db";

/* --- OTP simulation (in-memory only; identical UX to before) --- */
const otpMap = new Map<string, { code: string; expiresAt: number }>();
function generateOtp(target: string) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpMap.set(target, { code, expiresAt: Date.now() + 5 * 60_000 });
  return code;
}
function verifyOtp(target: string, code: string) {
  const e = otpMap.get(target);
  if (!e || Date.now() > e.expiresAt) return false;
  return e.code === code;
}

const STEPS = ["Account", "Business", "Address", "Bank", "Tax & Legal", "Documents", "Review"] as const;
const searchSchema = z.object({ step: z.coerce.number().min(1).max(7).optional() });

export const Route = createFileRoute("/register")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Seller Registration — Seller Hub" },
      { name: "description", content: "Create your seller account in 7 steps." },
      { property: "og:title", content: "Seller Registration — Seller Hub" },
      { property: "og:description", content: "Create your seller account in 7 steps." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const search = useSearch({ from: "/register" });
  const [step, setStep] = useState<number>(search.step ?? 1);
  const sellerQ = useMySeller();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { redirect: "/register" }, replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (search.step && search.step !== step) setStep(search.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.step]);

  const goto = (n: number) => {
    setStep(n);
    navigate({ to: "/register", search: { step: n } });
  };

  if (loading || sellerQ.isLoading || !sellerQ.data) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  const seller = sellerQ.data;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground font-bold">S</div>
            <span className="truncate font-semibold">Seller Hub</span>
          </Link>
          <TopStepTabs current={step} onGoto={goto} />
          <Link to="/seller" className="text-xs font-semibold uppercase tracking-wide text-primary hover:underline sm:text-sm">
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_260px]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <OnboardingChecklist seller={seller} current={step} onGoto={goto} />
        </aside>

        <section className="min-w-0">
          <div key={step} className="animate-fade-in">
            {step === 1 && <StepAccount seller={seller} onNext={() => goto(2)} />}
            {step === 2 && <StepBusiness seller={seller} onBack={() => goto(1)} onNext={() => goto(3)} />}
            {step === 3 && <StepAddress seller={seller} onBack={() => goto(2)} onNext={() => goto(4)} />}
            {step === 4 && <StepBank seller={seller} onBack={() => goto(3)} onNext={() => goto(5)} />}
            {step === 5 && <StepTax seller={seller} onBack={() => goto(4)} onNext={() => goto(6)} />}
            {step === 6 && <StepDocuments seller={seller} onBack={() => goto(5)} onNext={() => goto(7)} />}
            {step === 7 && <StepReview seller={seller} onEdit={(n) => goto(n)} onBack={() => goto(6)} />}
          </div>
        </section>

        <aside className="hidden space-y-4 xl:block xl:sticky xl:top-6 xl:self-start">
          <PromoCard
            title="Need help with GST or PAN?"
            body="Get GST registration, filing and trademark help from our verified partners."
            cta="Learn more"
          />
          <PromoCard
            title="Join our Seller Community"
            body="Smart selling hacks, feature updates and handy tips from top sellers."
            cta="Open community"
            tone="accent"
          />
        </aside>
      </main>

    </div>
  );
}

/* ---------- Top step tabs (Flipkart-style current path) ---------- */
function TopStepTabs({ current, onGoto }: { current: number; onGoto: (n: number) => void }) {
  return (
    <ol className="hidden min-w-0 flex-1 items-center justify-center gap-3 overflow-hidden md:flex xl:gap-4">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "active" : "todo";
        return (
          <li key={label} className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => n <= current && onGoto(n)}
              disabled={n > current}
              className={[
                "grid h-5 w-5 place-items-center rounded-full border text-[10px] font-bold transition-colors",
                state === "done"
                  ? "border-success bg-success text-success-foreground"
                  : state === "active"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground",
              ].join(" ")}
            >
              {state === "done" ? <Check className="h-3 w-3" /> : n}
            </button>
            <span
              className={[
                "hidden truncate font-semibold uppercase tracking-wide xl:inline",
                state === "active"
                  ? "text-foreground border-b-2 border-primary pb-1"
                  : "text-muted-foreground",
              ].join(" ")}
            >
              {label}
            </span>

          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Left checklist with completion % ---------- */
function OnboardingChecklist({
  seller, current, onGoto,
}: { seller: Seller; current: number; onGoto: (n: number) => void }) {
  const items = useMemo(() => {
    const a = seller.account, b = seller.business, ad = seller.address, bk = seller.bank, tx = seller.tax, dc = seller.documents;
    return [
      { step: 1, group: "Account", label: "Mobile verification", done: !!a.mobileVerified },
      { step: 1, group: "Account", label: "Email verification", done: !!a.emailVerified },
      { step: 2, group: "Business Details", label: "Shop & category", done: !!(b.shopName && b.category) },
      { step: 2, group: "Business Details", label: "Owner & description", done: !!(b.ownerName && b.description) },
      { step: 3, group: "Store & Pickup", label: "Shop address", done: !!(ad.shopAddress && ad.pincode) },
      { step: 3, group: "Store & Pickup", label: "Pickup address", done: !!(ad.pickupSame || ad.pickupAddress) },
      { step: 4, group: "Bank", label: "Bank account", done: !!(bk.accountNumber && bk.ifsc) },
      { step: 5, group: "Tax & Legal", label: "PAN added", done: !!tx.pan },
      { step: 6, group: "Documents", label: "ID & bank proof", done: !!(dc.panCard && dc.govId && dc.bankProof) },
      { step: 6, group: "Documents", label: "Logo & banner", done: !!(dc.shopLogo && dc.shopBanner) },
    ];
  }, [seller]);

  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);

  const groups = useMemo(() => {
    const map = new Map<string, { step: number; items: typeof items }>();
    for (const it of items) {
      const g = map.get(it.group) ?? { step: it.step, items: [] as typeof items };
      g.items.push(it);
      map.set(it.group, g);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Your onboarding status</p>
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className="mt-2 h-1.5" />
      <ul className="mt-4 space-y-4">
        {groups.map(([group, { step, items }]) => {
          const isCurrent = step === current;
          return (
            <li key={group}>
              <button
                type="button"
                onClick={() => onGoto(step)}
                className={[
                  "text-left text-xs font-semibold uppercase tracking-wide transition-colors",
                  isCurrent ? "text-primary" : "text-foreground hover:text-primary",
                ].join(" ")}
              >
                {group}
              </button>
              <ul className="mt-1.5 space-y-1.5 pl-1">
                {items.map((it) => (
                  <li key={it.label} className="flex items-center gap-2 text-xs">
                    <span
                      className={[
                        "grid h-4 w-4 place-items-center rounded-full border",
                        it.done
                          ? "border-success bg-success text-success-foreground"
                          : "border-accent bg-background text-accent",
                      ].join(" ")}
                    >
                      {it.done ? <Check className="h-2.5 w-2.5" /> : <span className="h-1 w-1 rounded-full bg-accent" />}
                    </span>
                    <span className={it.done ? "text-foreground" : "text-muted-foreground"}>{it.label}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 rounded-lg bg-muted/60 p-2 text-center text-[11px] text-muted-foreground md:hidden">
        Step {current} of {STEPS.length} — {STEPS[current - 1]}
      </div>
    </div>
  );
}

function PromoCard({
  title, body, cta, tone = "primary",
}: { title: string; body: string; cta: string; tone?: "primary" | "accent" }) {
  return (
    <div
      className={[
        "rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md",
        tone === "accent" ? "border-accent/40 bg-accent/10" : "border-primary/20 bg-primary/5",
      ].join(" ")}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
      <button type="button" className="mt-3 text-xs font-semibold uppercase tracking-wide text-primary hover:underline">
        {cta} →
      </button>
    </div>
  );
}

/* Debounced autosave — saves patch to supabase 700ms after last change. */
function useAutosave<K extends keyof Seller>(_seller: Seller, key: K, values: Seller[K]) {
  const update = useUpdateMySeller();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { update.mutate({ [key]: values } as any); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, key]);
}

/* ---------------- Step 1: Account ---------------- */

const accountSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(80),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile"),
  email: z.string().trim().email("Invalid email").max(120),
});

function StepAccount({ seller, onNext }: { seller: Seller; onNext: () => void }) {
  const [values, setValues] = useState({
    fullName: seller.account.fullName,
    mobile: seller.account.mobile,
    email: seller.account.email,
  });
  const update = useUpdateMySeller();
  useAutosave(seller, "account", { ...seller.account, ...values });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailCode, setEmailCode] = useState("");
  const [mobileCode, setMobileCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [mobileSent, setMobileSent] = useState(false);

  const emailVerified = seller.account.emailVerified;
  const mobileVerified = seller.account.mobileVerified;

  const sendEmailOtp = () => {
    const p = accountSchema.shape.email.safeParse(values.email);
    if (!p.success) return setErrors((e) => ({ ...e, email: p.error.issues[0].message }));
    const code = generateOtp("email:" + values.email);
    setEmailSent(true);
    toast.success(`Email OTP: ${code}`, { description: "Simulated — enter to verify." });
  };
  const sendMobileOtp = () => {
    const p = accountSchema.shape.mobile.safeParse(values.mobile);
    if (!p.success) return setErrors((e) => ({ ...e, mobile: p.error.issues[0].message }));
    const code = generateOtp("mobile:" + values.mobile);
    setMobileSent(true);
    toast.success(`Mobile OTP: ${code}`, { description: "Simulated — enter to verify." });
  };
  const verifyEmail = async () => {
    if (verifyOtp("email:" + values.email, emailCode)) {
      await update.mutateAsync({ account: { ...seller.account, ...values, emailVerified: true } });
      toast.success("Email verified");
    } else toast.error("Invalid or expired OTP");
  };
  const verifyMobile = async () => {
    if (verifyOtp("mobile:" + values.mobile, mobileCode)) {
      await update.mutateAsync({ account: { ...seller.account, ...values, mobileVerified: true } });
      toast.success("Mobile verified");
    } else toast.error("Invalid or expired OTP");
  };

  const submit = async () => {
    const p = accountSchema.safeParse(values);
    if (!p.success) {
      const errs: Record<string, string> = {};
      p.error.issues.forEach((i) => (errs[String(i.path[0])] = i.message));
      return setErrors(errs);
    }
    if (!emailVerified) return toast.error("Please verify your email to continue");
    await update.mutateAsync({ account: { ...seller.account, ...values } });
    onNext();
  };

  return (
    <StepCard title="Create your seller account" subtitle="Step 1 of 7">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.fullName}>
          <Input value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} placeholder="Jane Doe" />
        </Field>
        <Field label="Email address" error={errors.email}
          right={emailVerified ? <span className="inline-flex items-center gap-1 text-xs text-success"><MailCheck className="h-3.5 w-3.5" /> Verified</span> : null}>
          <div className="flex gap-2">
            <Input type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} disabled={emailVerified} />
            <Button type="button" variant="outline" onClick={sendEmailOtp} disabled={emailVerified}><Send className="h-4 w-4" /> Send OTP</Button>
          </div>
          {emailSent && !emailVerified && (
            <div className="mt-2 flex gap-2">
              <Input inputMode="numeric" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" />
              <Button type="button" onClick={verifyEmail}>Verify</Button>
            </div>
          )}
        </Field>
        <Field label="Mobile number" error={errors.mobile}
          right={mobileVerified ? <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="h-3.5 w-3.5" /> Verified</span> : null}>
          <div className="flex gap-2">
            <Input value={values.mobile} onChange={(e) => setValues({ ...values, mobile: e.target.value.replace(/\D/g, "") })} placeholder="10-digit mobile" disabled={mobileVerified} />
            <Button type="button" variant="outline" onClick={sendMobileOtp} disabled={mobileVerified}><Send className="h-4 w-4" /> Send OTP</Button>
          </div>
          {mobileSent && !mobileVerified && (
            <div className="mt-2 flex gap-2">
              <Input inputMode="numeric" maxLength={6} value={mobileCode} onChange={(e) => setMobileCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" />
              <Button type="button" onClick={verifyMobile}>Verify</Button>
            </div>
          )}
        </Field>
      </div>
      <StepFooter>
        <Link to="/seller"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Dashboard</Button></Link>
        <Button onClick={submit} disabled={update.isPending}>Save & Continue <ArrowRight className="h-4 w-4" /></Button>
      </StepFooter>
    </StepCard>
  );
}

/* ---------------- Step 2: Business ---------------- */

const businessSchema = z.object({
  shopName: z.string().trim().min(2, "Required").max(80),
  ownerName: z.string().trim().min(2, "Required").max(80),
  businessType: z.enum(["Individual", "Sole Proprietorship", "Partnership", "Private Limited"]),
  category: z.string().trim().min(2, "Required"),
  description: z.string().trim().min(10, "Add a short description").max(500),
});
const CATEGORIES = ["Fashion","Electronics","Home & Kitchen","Groceries","Beauty","Books","Textiles","Toys","Sports","Other"];

function StepBusiness({ seller, onBack, onNext }: { seller: Seller; onBack: () => void; onNext: () => void }) {
  const [v, setV] = useState(seller.business);
  useAutosave(seller, "business", v);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useUpdateMySeller();
  const submit = async () => {
    const p = businessSchema.safeParse(v);
    if (!p.success) {
      const errs: Record<string, string> = {}; p.error.issues.forEach((i) => (errs[String(i.path[0])] = i.message));
      return setErrors(errs);
    }
    await update.mutateAsync({ business: v });
    onNext();
  };
  return (
    <StepCard title="Business information" subtitle="Step 2 of 7">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shop name" error={errors.shopName}><Input value={v.shopName} onChange={(e) => setV({ ...v, shopName: e.target.value })} /></Field>
        <Field label="Owner name" error={errors.ownerName}><Input value={v.ownerName} onChange={(e) => setV({ ...v, ownerName: e.target.value })} /></Field>
        <Field label="Business type" error={errors.businessType}>
          <Select value={v.businessType || undefined} onValueChange={(x) => setV({ ...v, businessType: x as BusinessType })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {["Individual","Sole Proprietorship","Partnership","Private Limited"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Category" error={errors.category}>
          <Select value={v.category || undefined} onValueChange={(x) => setV({ ...v, category: x })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Shop description" error={errors.description}>
            <Textarea rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="What do you sell and what makes you different?" />
          </Field>
        </div>
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button onClick={submit} disabled={update.isPending}>Save & Continue <ArrowRight className="h-4 w-4" /></Button>
      </StepFooter>
    </StepCard>
  );
}

/* ---------------- Step 3: Address ---------------- */

const addressSchema = z.object({
  shopAddress: z.string().trim().min(4, "Required"),
  city: z.string().trim().min(2, "Required"),
  state: z.string().trim().min(2, "Required"),
  pincode: z.string().regex(/^\d{6}$/, "6-digit pincode"),
  landmark: z.string().max(80).optional().or(z.literal("")),
  pickupSame: z.boolean(),
  pickupAddress: z.string().optional().or(z.literal("")),
  pickupCity: z.string().optional().or(z.literal("")),
  pickupState: z.string().optional().or(z.literal("")),
  pickupPincode: z.string().optional().or(z.literal("")),
}).refine((d) =>
  d.pickupSame || (d.pickupAddress && d.pickupCity && d.pickupState && /^\d{6}$/.test(d.pickupPincode || "")),
  { message: "Complete pickup address", path: ["pickupAddress"] });

function StepAddress({ seller, onBack, onNext }: { seller: Seller; onBack: () => void; onNext: () => void }) {
  const [v, setV] = useState(seller.address);
  useAutosave(seller, "address", v);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useUpdateMySeller();
  const submit = async () => {
    const p = addressSchema.safeParse(v);
    if (!p.success) {
      const errs: Record<string, string> = {}; p.error.issues.forEach((i) => (errs[String(i.path[0])] = i.message));
      return setErrors(errs);
    }
    await update.mutateAsync({ address: v });
    onNext();
  };
  return (
    <StepCard title="Business address" subtitle="Step 3 of 7">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Shop address" error={errors.shopAddress}>
            <Textarea rows={2} value={v.shopAddress} onChange={(e) => setV({ ...v, shopAddress: e.target.value })} />
          </Field>
        </div>
        <Field label="City" error={errors.city}><Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></Field>
        <Field label="State" error={errors.state}><Input value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })} /></Field>
        <Field label="Pincode" error={errors.pincode}>
          <Input value={v.pincode} onChange={(e) => setV({ ...v, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
        </Field>
        <Field label="Landmark (optional)"><Input value={v.landmark} onChange={(e) => setV({ ...v, landmark: e.target.value })} /></Field>

        <div className="sm:col-span-2 flex items-center gap-2 pt-2">
          <Checkbox id="pickupSame" checked={v.pickupSame} onCheckedChange={(x) => setV({ ...v, pickupSame: Boolean(x) })} />
          <Label htmlFor="pickupSame" className="cursor-pointer">Pickup address is same as shop address</Label>
        </div>

        {!v.pickupSame && (
          <>
            <div className="sm:col-span-2">
              <Field label="Pickup address" error={errors.pickupAddress}>
                <Textarea rows={2} value={v.pickupAddress} onChange={(e) => setV({ ...v, pickupAddress: e.target.value })} />
              </Field>
            </div>
            <Field label="City"><Input value={v.pickupCity} onChange={(e) => setV({ ...v, pickupCity: e.target.value })} /></Field>
            <Field label="State"><Input value={v.pickupState} onChange={(e) => setV({ ...v, pickupState: e.target.value })} /></Field>
            <Field label="Pincode">
              <Input value={v.pickupPincode} onChange={(e) => setV({ ...v, pickupPincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
            </Field>
          </>
        )}
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button onClick={submit} disabled={update.isPending}>Save & Continue <ArrowRight className="h-4 w-4" /></Button>
      </StepFooter>
    </StepCard>
  );
}

/* ---------------- Step 4: Bank ---------------- */

const bankSchema = z.object({
  holderName: z.string().trim().min(2, "Required"),
  bankName: z.string().trim().min(2, "Required"),
  accountNumber: z.string().regex(/^\d{9,18}$/, "9–18 digit account number"),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC (e.g. HDFC0001234)"),
  upi: z.string().regex(/^[\w.\-]{2,}@[\w\-]{2,}$/, "Invalid UPI ID").optional().or(z.literal("")),
});

function StepBank({ seller, onBack, onNext }: { seller: Seller; onBack: () => void; onNext: () => void }) {
  const [v, setV] = useState(seller.bank);
  useAutosave(seller, "bank", v);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useUpdateMySeller();
  const submit = async () => {
    const p = bankSchema.safeParse({ ...v, ifsc: v.ifsc.toUpperCase() });
    if (!p.success) {
      const errs: Record<string, string> = {}; p.error.issues.forEach((i) => (errs[String(i.path[0])] = i.message));
      return setErrors(errs);
    }
    await update.mutateAsync({ bank: { ...v, ifsc: v.ifsc.toUpperCase() } });
    onNext();
  };
  return (
    <StepCard title="Bank details" subtitle="Step 4 of 7">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account holder name" error={errors.holderName}><Input value={v.holderName} onChange={(e) => setV({ ...v, holderName: e.target.value })} /></Field>
        <Field label="Bank name" error={errors.bankName}><Input value={v.bankName} onChange={(e) => setV({ ...v, bankName: e.target.value })} /></Field>
        <Field label="Account number" error={errors.accountNumber}>
          <Input value={v.accountNumber} onChange={(e) => setV({ ...v, accountNumber: e.target.value.replace(/\D/g, "").slice(0, 18) })} />
        </Field>
        <Field label="IFSC code" error={errors.ifsc}>
          <Input value={v.ifsc} onChange={(e) => setV({ ...v, ifsc: e.target.value.toUpperCase().slice(0, 11) })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="UPI ID (optional)" error={errors.upi}><Input value={v.upi} onChange={(e) => setV({ ...v, upi: e.target.value })} /></Field>
        </div>
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button onClick={submit} disabled={update.isPending}>Save & Continue <ArrowRight className="h-4 w-4" /></Button>
      </StepFooter>
    </StepCard>
  );
}

/* ---------------- Step 5: Tax ---------------- */

const taxSchema = z.object({
  pan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Invalid PAN (e.g. ABCDE1234F)"),
  gst: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/, "Invalid GSTIN").optional().or(z.literal("")),
  businessRegNumber: z.string().max(40).optional().or(z.literal("")),
});

function StepTax({ seller, onBack, onNext }: { seller: Seller; onBack: () => void; onNext: () => void }) {
  const [v, setV] = useState(seller.tax);
  useAutosave(seller, "tax", v);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useUpdateMySeller();
  const submit = async () => {
    const p = taxSchema.safeParse({ ...v, pan: v.pan.toUpperCase(), gst: v.gst.toUpperCase() });
    if (!p.success) {
      const errs: Record<string, string> = {}; p.error.issues.forEach((i) => (errs[String(i.path[0])] = i.message));
      return setErrors(errs);
    }
    await update.mutateAsync({ tax: { ...v, pan: v.pan.toUpperCase(), gst: v.gst.toUpperCase() } });
    onNext();
  };
  return (
    <StepCard title="Tax & legal details" subtitle="Step 5 of 7">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PAN number" error={errors.pan}>
          <Input value={v.pan} onChange={(e) => setV({ ...v, pan: e.target.value.toUpperCase().slice(0, 10) })} placeholder="ABCDE1234F" />
        </Field>
        <Field label="GST number (optional)" error={errors.gst}>
          <Input value={v.gst} onChange={(e) => setV({ ...v, gst: e.target.value.toUpperCase().slice(0, 15) })} placeholder="22ABCDE1234F1Z5" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Business registration number (optional)" error={errors.businessRegNumber}>
            <Input value={v.businessRegNumber} onChange={(e) => setV({ ...v, businessRegNumber: e.target.value })} />
          </Field>
        </div>
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button onClick={submit} disabled={update.isPending}>Save & Continue <ArrowRight className="h-4 w-4" /></Button>
      </StepFooter>
    </StepCard>
  );
}

/* ---------------- Step 6: Documents (upload to Supabase storage) ---------------- */

const DOC_FIELDS: Array<{ key: keyof SellerDocuments; label: string; required: boolean; accept: string }> = [
  { key: "panCard", label: "PAN Card", required: true, accept: "image/*,.pdf" },
  { key: "govId", label: "Aadhaar / Government ID", required: true, accept: "image/*,.pdf" },
  { key: "gstCertificate", label: "GST Certificate (optional)", required: false, accept: "image/*,.pdf" },
  { key: "bankProof", label: "Cancelled Cheque / Bank Proof", required: true, accept: "image/*,.pdf" },
  { key: "shopLogo", label: "Shop Logo", required: true, accept: "image/*" },
  { key: "shopBanner", label: "Shop Banner", required: true, accept: "image/*" },
];

function StepDocuments({ seller, onBack, onNext }: { seller: Seller; onBack: () => void; onNext: () => void }) {
  const [docs, setDocs] = useState<SellerDocuments>(seller.documents);
  const [busy, setBusy] = useState<string | null>(null);
  const update = useUpdateMySeller();
  const { user } = useAuth();

  const handleFile = async (key: keyof SellerDocuments, file?: File | null) => {
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("File must be under 5 MB");
    setBusy(key as string);
    try {
      const stored: StoredFile = await uploadSellerDoc(user.id, seller.id, key as string, file);
      const next = { ...docs, [key]: stored };
      setDocs(next);
      await update.mutateAsync({ documents: next });
      toast.success("Uploaded");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    const missing = DOC_FIELDS.filter((d) => d.required && !docs[d.key]);
    if (missing.length) return toast.error(`Missing: ${missing.map((m) => m.label).join(", ")}`);
    await update.mutateAsync({ documents: docs });
    onNext();
  };

  return (
    <StepCard title="Upload documents" subtitle="Step 6 of 7">
      <div className="grid gap-3">
        {DOC_FIELDS.map(({ key, label, required, accept }) => {
          const f = docs[key];
          return (
            <div key={key} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><FileUp className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {label}{required && <span className="text-destructive">*</span>}
                </div>
                {f ? <div className="mt-1 truncate text-xs text-muted-foreground">{f.name} · {((f.size ?? 0)/1024).toFixed(1)} KB</div>
                  : <div className="mt-1 text-xs text-muted-foreground">No file selected</div>}
              </div>
              <label className="cursor-pointer">
                <input type="file" className="hidden" accept={accept}
                  onChange={(e) => handleFile(key, e.target.files?.[0])} />
                <span className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                  {busy === key ? "Uploading…" : f ? "Replace" : "Upload"}
                </span>
              </label>
            </div>
          );
        })}
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button onClick={submit} disabled={update.isPending}>Save & Continue <ArrowRight className="h-4 w-4" /></Button>
      </StepFooter>
    </StepCard>
  );
}

/* ---------------- Step 7: Review + Submit ---------------- */

function StepReview({ seller, onEdit, onBack }: { seller: Seller; onEdit: (n: number) => void; onBack: () => void }) {
  const navigate = useNavigate();
  const submitMut = useSubmitMySeller();

  const sections = useMemo(() => ([
    { step: 1, title: "Account", rows: [
      ["Full name", seller.account.fullName],
      ["Email", `${seller.account.email}${seller.account.emailVerified ? " ✓" : ""}`],
      ["Mobile", `${seller.account.mobile}${seller.account.mobileVerified ? " ✓" : ""}`],
    ] as Array<[string, string]> },
    { step: 2, title: "Business", rows: [
      ["Shop name", seller.business.shopName],
      ["Owner", seller.business.ownerName],
      ["Type", seller.business.businessType],
      ["Category", seller.business.category],
    ] as Array<[string, string]> },
    { step: 3, title: "Address", rows: [
      ["Address", `${seller.address.shopAddress}, ${seller.address.city}, ${seller.address.state} - ${seller.address.pincode}`],
    ] as Array<[string, string]> },
    { step: 4, title: "Bank", rows: [
      ["Holder", seller.bank.holderName],
      ["Bank", seller.bank.bankName],
      ["Account", seller.bank.accountNumber.replace(/.(?=.{4})/g, "•")],
      ["IFSC", seller.bank.ifsc],
    ] as Array<[string, string]> },
    { step: 5, title: "Tax", rows: [
      ["PAN", seller.tax.pan],
      ["GST", seller.tax.gst || "—"],
    ] as Array<[string, string]> },
    { step: 6, title: "Documents", rows: Object.entries(seller.documents).map(([k, v]) => [k, v?.name || "—"]) as Array<[string, string]> },
  ]), [seller]);

  const doSubmit = async () => {
    const missingStorefrontMedia = [
      !seller.documents.shopLogo && "Shop Logo",
      !seller.documents.shopBanner && "Shop Banner",
    ].filter(Boolean);
    if (missingStorefrontMedia.length > 0) {
      toast.error(`Missing: ${missingStorefrontMedia.join(", ")}`);
      onEdit(6);
      return;
    }
    try {
      await submitMut.mutateAsync();
      toast.success("Application submitted for approval");
      navigate({ to: "/seller" });
    } catch (e: any) {
      toast.error(e?.message || "Submit failed");
    }
  };

  return (
    <StepCard title="Review & submit" subtitle="Step 7 of 7">
      <div className="grid gap-4">
        {sections.map((s) => (
          <Card key={s.step}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">{s.title}</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => onEdit(s.step)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-1 text-sm sm:grid-cols-[160px_1fr]">
                {s.rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium break-words">{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
      <StepFooter>
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button onClick={doSubmit} disabled={submitMut.isPending}>
          {submitMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Submit for approval
        </Button>
      </StepFooter>
    </StepCard>
  );
}

/* ---------------- shared shells ---------------- */

function StepCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function StepFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">{children}</div>;
}
function Field({ label, error, right, children }: { label: string; error?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>{right}
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
