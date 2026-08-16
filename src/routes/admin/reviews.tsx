import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star } from "lucide-react";
import { useAdminReviews, useModerateReview, useDeleteReview } from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/reviews")({
  head: () => ({ meta: [{ title: "Reviews — Admin" }, { name: "robots", content: "noindex" }] }),
  component: ReviewsPage,
});

function ReviewsPage() {
  const q = useAdminReviews();
  const mod = useModerateReview();
  const del = useDeleteReview();
  const [status, setStatus] = useState<"all" | "pending" | "approved" | "hidden" | "reported">(
    "all",
  );

  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (status !== "all") r = r.filter((x) => x.status === status);
    return r;
  }, [q.data, status]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Moderate customer reviews across all products.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "reported", "approved", "hidden"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={status === f ? "default" : "outline"}
            onClick={() => setStatus(f)}
            className="rounded-full capitalize"
          >
            {f}
          </Button>
        ))}
      </div>
      {q.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">
            No reviews match.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 stagger">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${i < r.rating ? "fill-accent text-accent" : "text-muted-foreground"}`}
                      />
                    ))}
                  </div>
                  {r.title && <span className="font-semibold">{r.title}</span>}
                  <Badge variant="outline" className="capitalize">
                    {r.status}
                  </Badge>
                  {r.reported_count > 0 && (
                    <Badge variant="destructive">{r.reported_count} reports</Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
                {r.body && <p className="text-sm text-muted-foreground">{r.body}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      mod.mutate(
                        { id: r.id, status: "approved" },
                        { onSuccess: () => toast.success("Approved") },
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      mod.mutate(
                        { id: r.id, status: "hidden" },
                        { onSuccess: () => toast.success("Hidden") },
                      )
                    }
                  >
                    Hide
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (confirm("Delete review?"))
                        del.mutate(r.id, { onSuccess: () => toast.success("Deleted") });
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
