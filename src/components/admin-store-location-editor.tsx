import { useState } from "react";
import { MapPin, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleStoreLocationPicker } from "@/components/google-store-location-picker";
import { useAdminUpdateStoreLocation, type AdminStore } from "@/lib/stores";
import { parseCoordinates, type Coordinates } from "@/lib/coordinates";

export function AdminStoreLocationEditor({ store }: { store: AdminStore }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pin, setPin] = useState<Coordinates | null>(
    store.resolved_location?.coordinates ?? parseCoordinates(store.latitude, store.longitude),
  );
  const [form, setForm] = useState({
    address: store.resolved_location?.address || store.address_line1 || "",
    address2: store.address_line2 ?? "",
    city: store.resolved_location?.city || store.city || "",
    state: store.resolved_location?.state || store.state || "",
    pincode: store.resolved_location?.pincode || store.pincode || "",
    placeId: store.google_place_id ?? (null as string | null),
    reason: "",
  });
  const save = useAdminUpdateStoreLocation();
  const canSave = Boolean(
    pin &&
    form.address.trim().length >= 4 &&
    form.city.trim() &&
    form.state.trim() &&
    /^\d{6}$/.test(form.pincode) &&
    form.reason.trim().length >= 4 &&
    !resolving &&
    !save.isPending,
  );

  const doSave = async () => {
    if (!pin || !canSave) return;
    try {
      await save.mutateAsync({
        storeId: store.id,
        addressLine1: form.address.trim(),
        addressLine2: form.address2.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode,
        latitude: pin.lat,
        longitude: pin.lng,
        googlePlaceId: form.placeId,
        reason: form.reason.trim(),
      });
      toast.success("Store location updated and recorded in the admin audit log.");
      setConfirming(false);
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Store location could not be saved.");
    }
  };

  if (!editing) {
    return (
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit location
      </Button>
    );
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-border p-4"
      aria-labelledby="store-location-edit-title"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 id="store-location-edit-title" className="font-semibold">
            Correct Store location
          </h3>
          <p className="text-xs text-muted-foreground">
            Google Places, map click, and pin dragging are available. A reason is required and the
            database RPC checks stores.manage.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      <GoogleStoreLocationPicker
        value={pin}
        addressLabel={form.address}
        title="Store location"
        description="Search for the address or move the pin to the physical shop entrance."
        onLocationChange={(update) => {
          setPin(update.coordinates);
          setResolving(update.pending);
          if (update.pending) return;
          if (update.address) {
            setForm((current) => ({
              ...current,
              address: update.address!.formattedAddress,
              city: update.address!.city,
              state: update.address!.state,
              pincode: update.address!.pincode.replace(/\D/g, "").slice(0, 6),
              placeId: update.address!.placeId,
            }));
          }
        }}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Address"
          value={form.address}
          onChange={(address) => setForm({ ...form, address })}
        />
        <Field
          label="Address line 2"
          value={form.address2}
          onChange={(address2) => setForm({ ...form, address2 })}
        />
        <Field label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} />
        <Field label="State" value={form.state} onChange={(state) => setForm({ ...form, state })} />
        <Field
          label="Pincode"
          value={form.pincode}
          onChange={(pincode) =>
            setForm({ ...form, pincode: pincode.replace(/\D/g, "").slice(0, 6) })
          }
        />
        <Field
          label="Correction reason"
          value={form.reason}
          onChange={(reason) => setForm({ ...form, reason })}
        />
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        {pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : "Select a point on the map"}
      </p>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogTrigger asChild>
          <Button disabled={!canSave} onClick={() => setConfirming(true)}>
            <Save className="mr-2 h-4 w-4" />
            Review and save
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <MapPin className="mr-2 inline h-4 w-4" />
              Confirm location correction?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This updates the Store coordinates and address. The old and new values plus your
              reason will be written to the existing Admin audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="rounded-lg bg-muted p-3 text-sm">
            {form.address}
            <br />
            {[form.city, form.state, form.pincode].filter(Boolean).join(", ")}
            <br />
            {pin?.lat.toFixed(6)}, {pin?.lng.toFixed(6)}
            <br />
            <span className="text-muted-foreground">Reason: {form.reason}</span>
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canSave}
              onClick={(event) => {
                event.preventDefault();
                void doSave();
              }}
            >
              {save.isPending ? "Saving…" : "Confirm correction"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `store-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
