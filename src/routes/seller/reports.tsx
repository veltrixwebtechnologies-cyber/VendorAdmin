import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/seller/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Seller Hub" },
      { name: "description", content: "Downloadable sales, orders, inventory and payment reports." },
      { property: "og:title", content: "Reports — Seller Hub" },
      { property: "og:description", content: "Downloadable business reports." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="Reports"
      description="Generate downloadable sales, orders, inventory and payment reports."
    />
  ),
});
