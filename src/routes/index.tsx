import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Package, ShieldCheck, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Become a Seller — Seller Hub" },
      {
        name: "description",
        content:
          "Join our marketplace in 7 simple steps. Reach millions of customers with a verified seller account.",
      },
      { property: "og:title", content: "Become a Seller — Seller Hub" },
      {
        property: "og:description",
        content:
          "Join our marketplace in 7 simple steps. Reach millions of customers with a verified seller account.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
              S
            </div>
            <span className="text-lg font-semibold">Seller Hub</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="outline">Seller Login</Button>
            </Link>
            <Link to="/auth">
              <Button>Become a Seller</Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div className="animate-fade-in-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground animate-scale-in">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              Multi-vendor marketplace
            </span>
            <h1 className="mt-4 text-5xl font-bold leading-tight tracking-tight text-foreground">
              Sell to millions. <span className="text-primary">Get verified in days.</span>
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Register your business, upload documents, and start receiving orders from customers
              across the country. All you need is an email and a bank account.
            </p>
            <div className="mt-8 flex gap-3">
              <Link to="/auth">
                <Button size="lg" className="gap-2 hover-scale">
                  Get started <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/register">
                <Button size="lg" variant="outline" className="hover-scale">
                  Full registration wizard
                </Button>
              </Link>
            </div>

            <ul className="mt-8 grid gap-3 text-sm text-muted-foreground stagger">
              {[
                "7-step guided onboarding",
                "Simulated OTP email/mobile verification",
                "Admin review with approve / reject / request more info",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 stagger">
            <FeatureCard
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Verified accounts"
              text="Documents reviewed by admin before you go live."
            />
            <FeatureCard
              icon={<Package className="h-5 w-5" />}
              title="Simple store setup"
              text="Onboarding checklist takes you from empty to selling."
            />
            <FeatureCard
              icon={<TrendingUp className="h-5 w-5" />}
              title="Grow with insights"
              text="Track orders, revenue and best-sellers as you scale."
            />
            <FeatureCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="Fast settlements"
              text="Delivered orders auto-flow into payout queue."
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Seller Hub. Phase 1 preview.
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 hover-lift">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
