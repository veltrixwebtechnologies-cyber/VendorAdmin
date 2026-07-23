import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/seller/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — Seller Hub" },
      { name: "description", content: "Customer ratings and reviews." },
      { property: "og:title", content: "Reviews — Seller Hub" },
      { property: "og:description", content: "Customer ratings and reviews." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="Reviews"
      description="View ratings, read reviews, and reply to customers."
    />
  ),
});
