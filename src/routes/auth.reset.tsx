import { createFileRoute } from "@tanstack/react-router";

import { PasswordResetForm } from "@/components/password-reset-form";

export const Route = createFileRoute("/auth/reset")({
  head: () => ({
    meta: [{ title: "Reset password — Seller Hub" }, { name: "robots", content: "noindex" }],
  }),
  component: SellerPasswordResetPage,
});

function SellerPasswordResetPage() {
  return <PasswordResetForm title="Reset seller password" subtitle="Seller Hub" returnTo="/auth" />;
}
