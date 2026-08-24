import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Clock, Power, PowerOff, CalendarX2, CalendarPlus, RefreshCw, History, Globe2, Save, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useMySeller } from "@/lib/db";
import {
  DAYS, DAY_FULL,
  defaultWeeklyHours,
  validateTimeRange,
  isOvernightSchedule,
  TIMEZONES,
  useMyShopHours,
  useSaveAllShopHours,
  useShopStatus,
  useActiveOverride,
  useSetShopOverride,
  useRevertShopOverride,
  useShopHolidays,
  useAddShopHoliday,
  useDeleteShopHoliday,
  useAvailabilityLog,
  useUpdateShopTimezone,
  type ShopHour,
} from "@/lib/shop-availability";

export const Route = createFileRoute("/seller/hours")({
  head: () => ({
    meta: [
      { title: "Shop Hours — Seller Hub" },
      { name: "description", content: "Set your shop opening hours, closures, and holiday schedule." },
    ],
  }),
  component: ShopHoursPage,
});

/* ── helpers ─────────────────────────────────────────────────────────────── */
function fmt12(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

/* ── Live status chip ─────────────────────────────────────────────────────── */
function LiveStatusChip({ sellerId }: { sellerId: string }) {
  const q = useShopStatus(sellerId);
  if (q.isLoading) return <Badge variant="outline" className="animate-pulse">Checking…</Badge>;
  if (!q.data) return null;
  const { isOpen, label, status } = q.data;
  const colorMap: Record<string, string> = {
    open:            "bg-emerald-100 text-emerald-800 border-emerald-300",
    open_override:   "bg-blue-100 text-blue-800 border-blue-300",
    closed:          "bg-red-100 text-red-700 border-red-300",
    closed_override: "bg-amber-100 text-amber-800 border-amber-300",
    holiday:         "bg-purple-100 text-purple-800 border-purple-300",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${colorMap[status] ?? "bg-muted text-muted-foreground"}`}>
      <span className={`h-2 w-2 rounded-full ${isOpen ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
      {label}
    </span>
  );
}

/* ── Override panel ───────────────────────────────────────────────────────── */
function OverridePanel({ sellerId }: { sellerId: string }) {
  const overrideQ = useActiveOverride(sellerId);
  const setOverride = useSetShopOverride();
  const revert = useRevertShopOverride();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [showForm, setShowForm] = useState(false);

  const active = overrideQ.data;
  const busy = setOverride.isPending || revert.isPending;

  async function handleClose() {
    try {
      await setOverride.mutateAsync({
        sellerId, kind: "temporary_closed", reason: reason || undefined,
        effectiveUntil: until ? new Date(until).toISOString() : null,
      });
      toast.success("Shop marked as temporarily closed");
      setShowForm(false); setReason(""); setUntil("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  async function handleOpen() {
    try {
      await setOverride.mutateAsync({ sellerId, kind: "manual_open", reason: reason || undefined });
      toast.success("Shop manually opened");
      setShowForm(false); setReason("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  async function handleRevert() {
    try {
      await revert.mutateAsync(sellerId);
      toast.success("Override removed — schedule resumed");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2"><Power className="h-4 w-4 text-primary" />Manual Override</h2>
        {active && (
          <Button size="sm" variant="outline" onClick={handleRevert} disabled={busy} className="text-emerald-600 border-emerald-300 hover:bg-emerald-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Resume Schedule
          </Button>
        )}
      </div>

      {active && (
        <div className={`rounded-lg border p-3 text-sm ${active.kind === "manual_open" ? "bg-blue-50 border-blue-200 text-blue-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          <p className="font-semibold capitalize">{active.kind.replace(/_/g, " ")}</p>
          {active.reason && <p className="text-xs mt-0.5">{active.reason}</p>}
          {active.effectiveUntil && <p className="text-xs mt-0.5">Until: {new Date(active.effectiveUntil).toLocaleString()}</p>}
        </div>
      )}

      {!showForm ? (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="destructive" onClick={() => setShowForm(true)} disabled={busy}>
            <PowerOff className="h-3.5 w-3.5 mr-1" />Temporarily Close
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowForm(true); }} disabled={busy} className="text-emerald-700 border-emerald-300 hover:bg-emerald-50">
            <Power className="h-3.5 w-3.5 mr-1" />Force Open
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg bg-muted/50 p-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Staff shortage, Renovations…" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Close until (leave blank for indefinite)</label>
            <input type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={handleClose} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Close Shop
            </Button>
            <Button size="sm" variant="outline" onClick={handleOpen} disabled={busy} className="text-emerald-700">
              Force Open
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Time input row ──────────────────────────────────────────────────────── */
function TimeRow({ hour, onChange }: { hour: ShopHour; onChange: (h: Partial<ShopHour>) => void }) {
  const overnight = hour.isOpen && isOvernightSchedule(hour.openTime, hour.closeTime);
  const err = hour.isOpen ? validateTimeRange(hour.openTime, hour.closeTime) : null;

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-3 w-28 shrink-0">
        <Switch checked={hour.isOpen} onCheckedChange={v => onChange({ isOpen: v })} id={`dow-${hour.dayOfWeek}`} />
        <label htmlFor={`dow-${hour.dayOfWeek}`} className="text-sm font-medium w-8">{DAY_FULL[hour.dayOfWeek].slice(0, 3)}</label>
      </div>
      {hour.isOpen ? (
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <input type="time" value={hour.openTime} onChange={e => onChange({ openTime: e.target.value })} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 w-[120px]" />
          <span className="text-muted-foreground text-xs">to</span>
          <input type="time" value={hour.closeTime} onChange={e => onChange({ closeTime: e.target.value })} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 w-[120px]" />
          {overnight && <span className="text-[11px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">Overnight</span>}
          {err && <span className="text-[11px] text-destructive">{err}</span>}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">Closed</span>
      )}
    </div>
  );
}

/* ── Holiday row ──────────────────────────────────────────────────────────── */
function HolidaySection({ sellerId }: { sellerId: string }) {
  const holidaysQ = useShopHolidays(sellerId);
  const addHoliday = useAddShopHoliday();
  const delHoliday = useDeleteShopHoliday();
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "", isClosed: true, specialOpen: "", specialClose: "" });
  const [showForm, setShowForm] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.startDate || !form.endDate) {
      toast.error("All fields required"); return;
    }
    try {
      await addHoliday.mutateAsync({
        sellerId, name: form.name, startDate: form.startDate, endDate: form.endDate,
        isClosed: form.isClosed,
        specialOpen:  form.isClosed ? null : form.specialOpen || null,
        specialClose: form.isClosed ? null : form.specialClose || null,
      });
      toast.success("Holiday / special event added");
      setForm({ name: "", startDate: "", endDate: "", isClosed: true, specialOpen: "", specialClose: "" });
      setShowForm(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2"><CalendarX2 className="h-4 w-4 text-primary" />Holidays &amp; Special Hours</h2>
        <Button size="sm" variant="outline" onClick={() => setShowForm(v => !v)}>
          <CalendarPlus className="h-3.5 w-3.5 mr-1" />{showForm ? "Cancel" : "Add"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="space-y-3 rounded-lg bg-muted/50 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name / Event</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Diwali, Christmas…" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch checked={form.isClosed} onCheckedChange={v => setForm(f => ({ ...f, isClosed: v }))} id="h-is-closed" />
              <label htmlFor="h-is-closed" className="text-sm">{form.isClosed ? "Full Day Closure" : "Special Hours"}</label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <input required type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <input required type="date" value={form.endDate} min={form.startDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          {!form.isClosed && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-muted-foreground">Special Open</label><input type="time" value={form.specialOpen} onChange={e => setForm(f => ({ ...f, specialOpen: e.target.value }))} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Special Close</label><input type="time" value={form.specialClose} onChange={e => setForm(f => ({ ...f, specialClose: e.target.value }))} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
            </div>
          )}
          <Button size="sm" type="submit" disabled={addHoliday.isPending}>
            {addHoliday.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Save
          </Button>
        </form>
      )}

      {holidaysQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (holidaysQ.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming holidays or special events.</p>
      ) : (
        <div className="space-y-2">
          {(holidaysQ.data ?? []).map(h => (
            <div key={h.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
              <div>
                <p className="font-medium">{h.name}</p>
                <p className="text-xs text-muted-foreground">{h.startDate} → {h.endDate} · {h.isClosed ? "Closed" : `${fmt12(h.specialOpen ?? "")} – ${fmt12(h.specialClose ?? "")}`}</p>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delHoliday.mutate({ id: h.id, sellerId })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Audit log ───────────────────────────────────────────────────────────── */
function AuditLog({ sellerId }: { sellerId: string }) {
  const logQ = useAvailabilityLog(sellerId);
  const ACTION_LABELS: Record<string, string> = {
    set_hours:      "Updated business hours",
    set_override:   "Set manual override",
    revert_override:"Reverted override",
    add_holiday:    "Added holiday / event",
    del_holiday:    "Deleted holiday / event",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><History className="h-4 w-4 text-primary" />Change Log</h2>
      {logQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (logQ.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
      ) : (
        <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
          {(logQ.data ?? []).map(e => (
            <div key={e.id} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 shrink-0 h-2 w-2 rounded-full bg-primary/40" />
              <div className="min-w-0">
                <p className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</p>
                <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */
function ShopHoursPage() {
  const sellerQ = useMySeller();
  const seller = sellerQ.data;
  const sellerId = seller?.id ?? null;

  const hoursQ = useMyShopHours(sellerId);
  const saveAll = useSaveAllShopHours();
  const updateTz = useUpdateShopTimezone();

  const [localHours, setLocalHours] = useState<ShopHour[] | null>(null);
  const [tz, setTz] = useState<string>("Asia/Kolkata");

  // Sync from server once loaded
  if (hoursQ.data && !localHours) setLocalHours(hoursQ.data);
  if (seller && tz === "Asia/Kolkata" && (seller as any).timezone && (seller as any).timezone !== tz) {
    setTz((seller as any).timezone);
  }

  const hours = localHours ?? hoursQ.data ?? [];

  function updateDay(dow: number, patch: Partial<ShopHour>) {
    setLocalHours(prev => (prev ?? hours).map(h => h.dayOfWeek === dow ? { ...h, ...patch } : h));
  }

  async function handleSave() {
    if (!sellerId) return;
    const hasError = hours.some(h => h.isOpen && !!validateTimeRange(h.openTime, h.closeTime));
    if (hasError) { toast.error("Fix time errors before saving"); return; }
    try {
      await saveAll.mutateAsync({ sellerId, hours: hours.map(h => ({ sellerId, dayOfWeek: h.dayOfWeek, isOpen: h.isOpen, openTime: h.openTime, closeTime: h.closeTime, breakStart: h.breakStart, breakEnd: h.breakEnd })) });
      if (tz !== (seller as any)?.timezone) await updateTz.mutateAsync({ sellerId, timezone: tz });
      toast.success("Business hours saved ✓");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    }
  }

  if (sellerQ.isLoading || hoursQ.isLoading) {
    return <div className="flex items-center justify-center h-40 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;
  }

  if (!seller || seller.status !== "approved") {
    return <div className="rounded-xl border border-dashed border-muted p-8 text-center text-sm text-muted-foreground">Your shop must be approved before you can configure hours.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Shop Hours</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Set when your shop is open. Override or add special events any time.</p>
        </div>
        {sellerId && <LiveStatusChip sellerId={sellerId} />}
      </div>

      {/* Override */}
      {sellerId && <OverridePanel sellerId={sellerId} />}

      {/* Weekly schedule */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />Weekly Schedule</h2>
          <Button size="sm" onClick={handleSave} disabled={saveAll.isPending || updateTz.isPending}>
            {saveAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save
          </Button>
        </div>

        {/* Timezone */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
          <Globe2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <select value={tz} onChange={e => setTz(e.target.value)} className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30">
            {TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {hours.map(h => (
          <TimeRow key={h.dayOfWeek} hour={h} onChange={patch => updateDay(h.dayOfWeek, patch)} />
        ))}
      </div>

      {/* Holidays */}
      {sellerId && <HolidaySection sellerId={sellerId} />}

      {/* Audit log */}
      {sellerId && <AuditLog sellerId={sellerId} />}
    </div>
  );
}
