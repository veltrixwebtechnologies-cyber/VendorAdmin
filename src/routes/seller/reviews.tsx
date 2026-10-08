import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, RefreshCw, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useMySeller } from "@/modules/seller/services/profile";

interface SellerReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  created_at: string;
  products: { name: string; seller_id: string } | null;
}

export const Route = createFileRoute("/seller/reviews")({
  head: () => ({ meta: [{ title: "Reviews — Seller Hub" }] }),
  component: ReviewsPage,
});

function ReviewsPage() {
  const sellerQ = useMySeller();
  const reviewsQ = useQuery({
    queryKey: ["seller-reviews", sellerQ.data?.id],
    enabled: !!sellerQ.data?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reviews")
        .select("id,rating,title,body,created_at,products!inner(name,seller_id)")
        .eq("products.seller_id", sellerQ.data!.id)
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SellerReview[];
    },
  });
  const reviews = reviewsQ.data ?? [];
  const average = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: reviews.filter((review) => review.rating === rating).length,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Approved customer feedback for products sold by your store.
        </p>
      </div>
      {reviewsQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : reviewsQ.isError ? (
        <Card className="border-destructive/30">
          <CardContent className="py-10 text-center">
            <p className="font-medium">Reviews could not be loaded.</p>
            <Button className="mt-3" variant="outline" onClick={() => void reviewsQ.refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[240px_1fr]">
            <Card>
              <CardContent className="flex h-full flex-col items-center justify-center py-6 text-center">
                <div className="text-4xl font-bold">{average.toFixed(1)}</div>
                <div className="mt-2 flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className={`h-4 w-4 ${index < Math.round(average) ? "fill-amber-400 text-amber-400" : "text-muted"}`}
                    />
                  ))}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{reviews.length} reviews</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Rating distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {distribution.map((row) => (
                  <div
                    key={row.rating}
                    className="grid grid-cols-[28px_1fr_36px] items-center gap-3 text-sm"
                  >
                    <span>{row.rating}★</span>
                    <Progress value={reviews.length ? (row.count / reviews.length) * 100 : 0} />
                    <span className="text-right text-muted-foreground">{row.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer reviews</CardTitle>
            </CardHeader>
            <CardContent>
              {reviews.length === 0 ? (
                <div className="py-12 text-center">
                  <MessageSquareText className="mx-auto h-9 w-9 text-muted-foreground/50" />
                  <p className="mt-3 font-medium">No reviews yet</p>
                  <p className="text-sm text-muted-foreground">
                    Verified customer reviews will appear here after completed orders.
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {reviews.map((review) => (
                    <article key={review.id} className="space-y-2 py-4 first:pt-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, index) => (
                            <Star
                              key={index}
                              className={`h-3.5 w-3.5 ${index < review.rating ? "fill-amber-400 text-amber-400" : "text-muted"}`}
                            />
                          ))}
                        </div>
                        <Badge variant="outline">{review.products?.name ?? "Product"}</Badge>
                        <time className="ml-auto text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                            new Date(review.created_at),
                          )}
                        </time>
                      </div>
                      {review.title && <h2 className="font-semibold">{review.title}</h2>}
                      {review.body && (
                        <p className="text-sm text-muted-foreground">{review.body}</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
