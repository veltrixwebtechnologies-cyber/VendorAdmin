import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MapPinned, MapPin, Search, Store as StoreIcon, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminAccess } from "@/shared/auth/admin-permissions";
import { useAdminStores } from "@/modules/admin/services/stores";

export const Route = createFileRoute("/admin/stores")({
  head: () => ({ meta: [{ title: "Stores — Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminStoresPage,
});

const pageSize = 12;
const statusLabel = (status: string) =>
  status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function AdminStoresPage() {
  const access = useAdminAccess();
  const query = useAdminStores({
    products: access.hasPermission("products.view"),
    orders: access.hasPermission("orders.view"),
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((store) => {
      const statusMatches = status === "all" || store.status === status;
      const searchable = [
        store.name,
        store.seller?.business_name,
        store.seller?.full_name,
        store.seller_id,
        store.address_line1,
        store.resolved_location?.address,
        store.resolved_location?.city || store.city,
        store.resolved_location?.state || store.state,
        store.pincode,
      ]
        .join(" ")
        .toLowerCase();
      return statusMatches && (!term || searchable.includes(term));
    });
  }, [query.data, search, status]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Stores</h1>
          <p className="text-sm text-muted-foreground">
            Physical locations linked to LocalShore seller businesses.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/store-map">
              <MapPinned className="mr-2 h-4 w-4" />
              Store map
            </Link>
          </Button>
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
      </div>

      {query.isError && (
        <Alert variant="destructive">
          <AlertTitle>Store data could not be loaded</AlertTitle>
          <AlertDescription>
            The Store schema may not be applied to this environment, or your account may lack
            stores.view. No seller records were substituted.
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search stores"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search store, seller, address…"
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter stores by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(
                [
                  "approved",
                  "active",
                  "draft",
                  "pending",
                  "disabled",
                  "suspended",
                  "rejected",
                ] as const
              ).map((item) => (
                <SelectItem key={item} value={item}>
                  {statusLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <StoreIcon className="h-9 w-9 text-muted-foreground/60" />
            <div>
              <h2 className="font-semibold">
                {query.data?.length ? "No stores match" : "No Store records available"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Store records appear here after the Store foundation is available in this database.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((store) => (
            <Card key={store.id} className="flex min-w-0 flex-col">
              <CardHeader className="pb-2">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">
                      {store.name || "Unnamed store"}
                    </CardTitle>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {store.seller?.business_name ||
                        store.seller?.full_name ||
                        `Seller ${store.seller_id.slice(0, 8)}`}
                    </p>
                  </div>
                  <Badge
                    variant={
                      store.status === "approved" || store.status === "active"
                        ? "default"
                        : "secondary"
                    }
                    className="capitalize"
                  >
                    {statusLabel(store.status || "unknown")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                  {[
                    store.resolved_location?.address || store.address_line1,
                    store.resolved_location?.city || store.city,
                    store.resolved_location?.state || store.state,
                    store.resolved_location?.pincode || store.pincode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Address not provided"}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {store.location_verified ? "Location verified" : "Verification pending"}
                  </span>
                  <span>
                    Radius:{" "}
                    {(store.resolved_service_radius?.km ?? store.service_radius_km) == null
                      ? "Not set"
                      : `${store.resolved_service_radius?.km ?? store.service_radius_km} km`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-3 text-xs">
                  <span>
                    Products{" "}
                    <strong className="text-foreground">{store.product_count ?? "—"}</strong>
                  </span>
                  <span>
                    Orders <strong className="text-foreground">{store.order_count ?? "—"}</strong>
                  </span>
                </div>
                <Button variant="outline" size="sm" className="mt-auto w-full" asChild>
                  <Link to="/admin/stores/$storeId" params={{ storeId: store.id }}>
                    View Store
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {rows.length > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {currentPage} of {totalPages} · {rows.length} stores
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
