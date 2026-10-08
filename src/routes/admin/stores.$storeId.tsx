import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { AdminStoreLocationEditor } from "@/modules/admin/components/admin-store-location-editor";
import { AdminStoresMap } from "@/modules/admin/components/admin-stores-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAdminAccess } from "@/shared/auth/admin-permissions";
import { useAdminStore } from "@/modules/admin/services/stores";
import { useAdminUpdateStore } from "@/modules/admin/services/stores";

export const Route = createFileRoute("/admin/stores/$storeId")({
  head: () => ({
    meta: [{ title: "Store details — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminStoreDetailPage,
});

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function AdminStoreDetailPage() {
  const { storeId } = Route.useParams();
  const access = useAdminAccess();
  const query = useAdminStore(storeId, {
    products: access.hasPermission("products.view"),
    orders: access.hasPermission("orders.view"),
  });
  const update = useAdminUpdateStore();
  const [confirmation, setConfirmation] = useState<
    { kind: "availability"; acceptsOrders: boolean } | { kind: "status"; status: string } | null
  >(null);
  const details = query.data;
  const store = details?.store;
  const canManage = access.hasPermission("stores.manage");

  const setAvailability = async (acceptsOrders: boolean) => {
    if (!store) return;
    try {
      await update.mutateAsync({ id: store.id, patch: { accepts_orders: acceptsOrders } });
      toast.success(acceptsOrders ? "Store availability enabled." : "Store temporarily paused.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Store could not be updated.");
    }
  };

  const setStoreStatus = async (status: string) => {
    if (!store) return;
    try {
      await update.mutateAsync({ id: store.id, patch: { status } });
      toast.success(`Store status changed to ${status}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Store status could not be updated.");
    }
  };

  if (query.isLoading)
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  if (query.isError || !store)
    return (
      <Card>
        <CardContent className="space-y-3 p-8 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-destructive" />
          <h1 className="font-semibold">Store details are unavailable</h1>
          <p className="text-sm text-muted-foreground">
            The Store may not exist in this environment or your role may not have stores.view.
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );

  const address = [
    store.resolved_location?.address ||
      [store.address_line1, store.address_line2].filter(Boolean).join(", "),
    store.resolved_location?.city || store.city,
    store.resolved_location?.state || store.state,
    store.resolved_location?.pincode || store.pincode,
    store.resolved_location?.country || store.country,
  ]
    .filter(Boolean)
    .join(", ");
  const coordinates = store.resolved_location?.coordinates;
  const schedules = details?.schedules as Array<{
    day_of_week: number;
    is_open: boolean;
    open_time: string;
    close_time: string;
  }> | null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button size="icon" variant="outline" asChild>
            <Link to="/admin/stores" aria-label="Back to stores">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">Store 360</p>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
              {store.name || "Unnamed store"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {store.seller?.business_name ||
                store.seller?.full_name ||
                `Seller ${store.seller_id.slice(0, 8)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              store.status === "approved" || store.status === "active" ? "default" : "secondary"
            }
            className="capitalize"
          >
            {store.status}
          </Badge>
          <Badge variant={store.location_verified ? "default" : "outline"}>
            {store.location_verified ? "Location verified" : "Verification pending"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Info
              label="Seller / business"
              value={store.seller?.business_name || store.seller?.full_name || store.seller_id}
            />
            <Info
              label="Seller status"
              value={store.seller?.status || "Unavailable to this role"}
            />
            <Info label="Store status" value={store.status || "Unknown"} />
            <Info label="Created" value={new Date(store.created_at).toLocaleString("en-IN")} />
            <Info label="Description" value={store.description || "Not provided"} />
            <Info label="Default store" value={store.is_default ? "Yes" : "No"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Info label="Accepting orders" value={store.accepts_orders ? "Yes" : "Paused"} />
            <Info
              label="Preparation time"
              value={
                store.estimated_prep_time_minutes
                  ? `${store.estimated_prep_time_minutes} min`
                  : "Not configured"
              }
            />
            <Info
              label="Service radius"
              value={
                (store.resolved_service_radius?.km ?? store.service_radius_km) == null
                  ? "Not configured"
                  : `${store.resolved_service_radius?.km ?? store.service_radius_km} km${store.resolved_service_radius?.source === "seller-legacy" ? " (legacy fallback)" : ""}`
              }
            />
            <Info label="Timezone" value={store.timezone || "Not configured"} />
            <p className="rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
              Store-level order availability is being introduced additively. Until the Store
              migration is verified and customer discovery/checkout is migrated, these controls
              update Store records only; existing seller-based customer availability remains
              authoritative.
            </p>
            {canManage && (
              <Button
                className="w-full"
                variant={store.accepts_orders ? "outline" : "default"}
                disabled={update.isPending}
                onClick={() =>
                  setConfirmation({ kind: "availability", acceptsOrders: !store.accepts_orders })
                }
              >
                {store.accepts_orders ? "Temporarily pause" : "Enable availability"}
              </Button>
            )}
            {canManage && store.status !== "disabled" && store.status !== "suspended" && (
              <Button
                className="w-full"
                variant="destructive"
                disabled={update.isPending}
                onClick={() => setConfirmation({ kind: "status", status: "disabled" })}
              >
                Disable Store
              </Button>
            )}
            {canManage && (store.status === "disabled" || store.status === "suspended") && (
              <Button
                className="w-full"
                disabled={
                  update.isPending || !["approved", "active"].includes(store.seller?.status ?? "")
                }
                onClick={() =>
                  setConfirmation({
                    kind: "status",
                    status: store.seller?.status === "active" ? "active" : "approved",
                  })
                }
              >
                Re-enable Store
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Info label="Address" value={address || "Not provided"} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Info
                label="Coordinates"
                value={coordinates ? `${coordinates.lat}, ${coordinates.lng}` : "Not set"}
              />
              <Info
                label="Location source"
                value={
                  store.location_source ||
                  store.resolved_location?.source ||
                  "Legacy source unknown"
                }
              />
            </div>
            <Info label="Google Place ID" value={store.google_place_id || "Not available"} />
            {coordinates && <AdminStoresMap stores={[store]} />}
            {canManage && <AdminStoreLocationEditor store={store} />}
            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Location corrections require stores.manage.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Operating hours
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {schedules?.length ? (
              schedules.map((item) => (
                <div
                  key={item.day_of_week}
                  className="flex justify-between gap-3 border-b py-2 text-sm last:border-0"
                >
                  <span>{dayNames[item.day_of_week] || `Day ${item.day_of_week}`}</span>
                  <span className="text-muted-foreground">
                    {item.is_open
                      ? `${item.open_time.slice(0, 5)} – ${item.close_time.slice(0, 5)}`
                      : "Closed"}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Operating schedule is unavailable. Existing Seller Hub hours remain seller-keyed
                during this migration.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Products
            </CardTitle>
          </CardHeader>
          <CardContent>
            {details?.productsError ? (
              <Unavailable message="Store product links are not available yet. Apply the B2 migration in a development database to link products to stores." />
            ) : details?.products?.length ? (
              <div className="space-y-2">
                {details.products.map((product: any) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0"
                  >
                    <span className="min-w-0 truncate">{product.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {product.stock} in stock · {product.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No Store-linked products found.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {details?.ordersError ? (
              <Unavailable message="Store order links are not available yet. Apply the B2 migration in a development database to link fulfillment Stores." />
            ) : details?.orders?.length ? (
              <div className="space-y-2">
                {details.orders.map((order: any) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0"
                  >
                    <span className="min-w-0 truncate">{order.order_number}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {order.status} · ₹{Number(order.total).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No Store-linked orders found.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Store performance metrics will be shown when Store-linked order data is available. No
            revenue is inferred from inventory.
          </p>
        </CardContent>
      </Card>
      <Button size="sm" variant="link" asChild>
        <Link to="/admin/vendors">
          View seller management <ExternalLink className="ml-2 h-3.5 w-3.5" />
        </Link>
      </Button>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.kind === "status"
                ? `${confirmation.status === "disabled" ? "Disable" : "Re-enable"} this Store?`
                : confirmation?.acceptsOrders
                  ? "Enable Store availability?"
                  : "Pause this Store temporarily?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.kind === "status"
                ? "This changes the Store’s operational status and is recorded in the existing audit log."
                : confirmation?.acceptsOrders
                  ? "This allows the Store to accept orders again."
                  : "This temporarily stops the Store from accepting orders. Existing order records are not changed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={update.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={update.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmation) return;
                const action =
                  confirmation.kind === "status"
                    ? setStoreStatus(confirmation.status)
                    : setAvailability(confirmation.acceptsOrders);
                void action.then(() => setConfirmation(null));
              }}
            >
              {update.isPending
                ? "Saving…"
                : confirmation?.kind === "status"
                  ? confirmation.status === "disabled"
                    ? "Disable Store"
                    : "Re-enable Store"
                  : confirmation?.acceptsOrders
                    ? "Enable Store"
                    : "Pause Store"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{value}</p>
    </div>
  );
}
function Unavailable({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
