import { createFileRoute } from "@tanstack/react-router";

import { PasswordResetForm } from "@/components/password-reset-form";

export const Route = createFileRoute("/admin/reset")({
  head: () => ({
    meta: [{ title: "Reset admin password — LocalShore" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminPasswordResetPage,
});

function AdminPasswordResetPage() {
  return (
    <PasswordResetForm
      title="Reset admin password"
      subtitle="Admin Console"
      returnTo="/admin/login"
    />
  );
}
