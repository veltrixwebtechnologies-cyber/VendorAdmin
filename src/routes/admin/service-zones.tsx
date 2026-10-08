/// <reference types="google.maps" />

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MapPinned, Pencil, Plus, Search, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { AdminServiceZonesMap } from "@/modules/admin/components/admin-stores-map";
import { GoogleStoreLocationPicker } from "@/components/google-store-location-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminAccess } from "@/shared/auth/admin-permissions";
import { parseCoordinates, type Coordinates } from "@/lib/coordinates";
import { useAssignStoreZone } from "@/modules/admin/services/stores";
import { useSaveServiceZone } from "@/modules/admin/services/stores";
import { useServiceZones } from "@/modules/admin/services/stores";
import { useStoreZoneAssignments } from "@/modules/admin/services/stores";
import { type ServiceZone } from "@/shared/shops/store-contracts";
import {} from "@/modules/admin/services/stores";
import { validateServiceZone } from "@/lib/store-domain";

export const Route = createFileRoute("/admin/service-zones")({
  head: () => ({
    meta: [{ title: "Service Zones — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: ServiceZonesPage,
});

function ServiceZonesPage() {
  const access = useAdminAccess();
  const canManage = access.hasPermission("service_zones.manage");
  const query = useServiceZones();
  const [search, setSearch] = useState("");
  const [showMap, setShowMap] = useState(true);
  const [editor, setEditor] = useState<ServiceZone | null | undefined>(undefined);
  const rows = useMemo(
    () =>
      (query.data ?? []).filter((zone) =>
        `${zone.name} ${zone.city}`.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [query.data, search],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Service Zones</h1>
          <p className="text-sm text-muted-foreground">
            Manage radius coverage used by delivery operations. Existing delivery zone records
            remain the source of truth.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowMap((value) => !value)}>
            <MapPinned className="mr-2 h-4 w-4" />
            {showMap ? "Hide map" : "View map"}
          </Button>
          {canManage && (
            <Button onClick={() => setEditor(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Create zone
            </Button>
          )}
        </div>
      </div>
      <Card>
        <CardContent className="p-4">
          <div className="relative max-w-lg">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search service zones"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search zone or city…"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>
      {showMap && (
        <Card>
          <CardHeader>
            <CardTitle>Radius coverage map</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminServiceZonesMap zones={rows} />
          </CardContent>
        </Card>
      )}
      {query.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Service zones could not be loaded. Confirm the Phase B5 migration and service_zones.view
            permission.
          </CardContent>
        </Card>
      ) : query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
            <MapPinned className="h-8 w-8 text-muted-foreground/50" />
            <div>
              <h2 className="font-semibold">
                {query.data?.length ? "No matching zones" : "No service zones configured"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                No zones are created by this page. Add one to configure delivery coverage.
              </p>
            </div>
            {canManage && !query.data?.length && (
              <Button onClick={() => setEditor(null)}>
                <Plus className="mr-2 h-4 w-4" />
                Create first zone
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((zone) => (
            <ServiceZoneCard
              key={zone.id}
              zone={zone}
              canManage={canManage}
              onEdit={() => setEditor(zone)}
            />
          ))}
        </div>
      )}
      {editor !== undefined && (
        <ServiceZoneEditor
          key={editor?.id ?? "new-zone"}
          zone={editor}
          onClose={() => setEditor(undefined)}
        />
      )}
    </div>
  );
}

function ServiceZoneCard({
  zone,
  canManage,
  onEdit,
}: {
  zone: ServiceZone;
  canManage: boolean;
  onEdit: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{zone.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{zone.city}</p>
          </div>
          <Badge variant={zone.is_active ? "default" : "secondary"}>
            {zone.is_active ? "Active" : "Disabled"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Coverage type</p>
            <p className="font-medium capitalize">{zone.zone_type} radius</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Radius</p>
            <p className="font-medium">{zone.radius_km} km</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Assigned stores</p>
            <p className="font-medium">{zone.store_count ?? "Unavailable"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Center</p>
            <p className="font-mono text-xs">
              {zone.latitude == null || zone.longitude == null
                ? "Not set"
                : `${zone.latitude.toFixed(4)}, ${zone.longitude.toFixed(4)}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2 border-t pt-3">
          {canManage && <StoreZoneAssignments zone={zone} />}
          {canManage && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StoreZoneAssignments({ zone }: { zone: ServiceZone }) {
  const [open, setOpen] = useState(false);
  const query = useStoreZoneAssignments(zone.id);
  const assign = useAssignStoreZone();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <StoreIcon className="mr-2 h-3.5 w-3.5" />
        Assign stores
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stores in {zone.name}</DialogTitle>
            <DialogDescription>
              Assignments complement each store’s own service radius and do not replace existing
              delivery logic.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-auto">
            {query.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading Stores…</p>
            ) : query.isError ? (
              <p className="text-sm text-destructive">
                Store assignments could not be loaded. Check schema and permission.
              </p>
            ) : query.data?.stores.length ? (
              query.data.stores.map(
                (store: { id: string; name: string | null; seller_id: string }) => (
                  <label
                    key={store.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      checked={query.data?.assigned.has(store.id) ?? false}
                      disabled={assign.isPending}
                      onCheckedChange={(checked) => {
                        void assign
                          .mutateAsync({
                            storeId: store.id,
                            zoneId: zone.id,
                            assigned: checked === true,
                          })
                          .catch((error) =>
                            toast.error(
                              error instanceof Error ? error.message : "Assignment failed.",
                            ),
                          );
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {store.name || "Unnamed store"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Seller {store.seller_id.slice(0, 8)}
                      </span>
                    </span>
                  </label>
                ),
              )
            ) : (
              <p className="text-sm text-muted-foreground">No Store records are available.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ServiceZoneEditor({ zone, onClose }: { zone: ServiceZone | null; onClose: () => void }) {
  const save = useSaveServiceZone();
  const currentPin = parseCoordinates(zone?.latitude, zone?.longitude);
  const [pin, setPin] = useState<Coordinates | null>(currentPin);
  const [form, setForm] = useState({
    name: zone?.name ?? "",
    city: zone?.city ?? "",
    radius: String(zone?.radius_km ?? 5),
    active: zone?.is_active ?? true,
  });
  const [resolving, setResolving] = useState(false);
  const submit = async () => {
    const radiusKm = Number(form.radius);
    const errors = validateServiceZone({
      name: form.name,
      city: form.city,
      latitude: pin?.lat ?? null,
      longitude: pin?.lng ?? null,
      radiusKm,
    });
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    try {
      await save.mutateAsync({
        id: zone?.id,
        name: form.name,
        city: form.city,
        latitude: pin!.lat,
        longitude: pin!.lng,
        radiusKm,
        isActive: form.active,
      });
      toast.success(zone ? "Service zone updated." : "Service zone created.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Service zone could not be saved.");
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{zone ? "Edit service zone" : "Create service zone"}</DialogTitle>
          <DialogDescription>
            Coverage is stored in the existing delivery_zones table and managed through
            service_zones permissions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="zone-name">Zone name</Label>
              <Input
                id="zone-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-city">City</Label>
              <Input
                id="zone-city"
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-radius">Radius (km)</Label>
              <Input
                id="zone-radius"
                type="number"
                inputMode="decimal"
                min="0.1"
                step="0.1"
                value={form.radius}
                onChange={(event) => setForm({ ...form, radius: event.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <Checkbox
                checked={form.active}
                onCheckedChange={(active) => setForm({ ...form, active: active === true })}
              />
              Enabled
            </label>
          </div>
          <GoogleStoreLocationPicker
            value={pin}
            title="Zone center"
            description="Search for a location or set the radius center by moving the pin."
            onLocationChange={(update) => {
              setPin(update.coordinates);
              setResolving(update.pending);
              if (!form.city && update.address?.city)
                setForm((current) => ({ ...current, city: update.address!.city }));
            }}
          />
          <p className="font-mono text-xs text-muted-foreground">
            {pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : "Select a zone center"}
            {resolving ? " · resolving address" : ""}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending || resolving || !pin}>
            {save.isPending ? "Saving…" : zone ? "Save changes" : "Create zone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
