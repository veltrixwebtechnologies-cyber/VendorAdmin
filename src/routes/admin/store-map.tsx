import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AdminStoresMap } from "@/modules/admin/components/admin-stores-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminAccess } from "@/shared/auth/admin-permissions";
import { useAdminStores } from "@/modules/admin/services/stores";

export const Route = createFileRoute("/admin/store-map")({
  head: () => ({ meta: [{ title: "Store map — Admin" }, { name: "robots", content: "noindex" }] }),
  component: StoreMapPage,
});

function StoreMapPage() {
  const access = useAdminAccess();
  const query = useAdminStores({
    products: access.hasPermission("products.view"),
    orders: access.hasPermission("orders.view"),
  });
  const stores = query.data ?? [];
  const mapped = stores.filter((store) => Boolean(store.resolved_location?.coordinates));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="link" size="sm" asChild className="-ml-3 mb-1">
            <Link to="/admin/stores">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Stores
            </Link>
          </Button>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Operational store map</h1>
          <p className="text-sm text-muted-foreground">
            Google Maps view of Store records with saved coordinates only.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Store locations unavailable</AlertTitle>
          <AlertDescription>
            Check the Store schema and your stores.view access. This map does not substitute
            seller/demo markers.
          </AlertDescription>
        </Alert>
      ) : query.isLoading ? (
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      ) : mapped.length ? (
        <Card>
          <CardContent className="p-3 sm:p-5">
            <AdminStoresMap stores={mapped} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid min-h-64 place-items-center p-8 text-center text-sm text-muted-foreground">
            No Store records with coordinates are available to map.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
