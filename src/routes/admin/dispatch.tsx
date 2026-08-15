import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, MapPin, RefreshCw, Search, Truck, UserRound } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAdminReassignDelivery, useDispatchCenter, useResolveDeliveryException, type DispatchAssignment, type TrackingEvent } from "@/lib/admin-delivery";

export const Route = createFileRoute("/admin/dispatch")({
  head: () => ({ meta: [{ title: "Dispatch Control Center — Admin" }, { name: "robots", content: "noindex" }] }),
  component: DispatchCenter,
});

const statuses = ["all", "pending", "accepted", "navigating_to_vendor", "reached_vendor", "picked_up", "out_for_delivery", "delivered", "failed"];
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const duration = (from: string, to?: string) => {
  if (!to) return "—";
  const mins = Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

function Timeline({ events }: { events: TrackingEvent[] }) {
  const sorted = [...events].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  return <div className="space-y-3">{sorted.length === 0 ? <p className="text-sm text-muted-foreground">No tracking events recorded.</p> : sorted.map((event, i) => (
    <div key={event.id} className="relative flex gap-3 text-sm">
      {i < sorted.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-border" />}
      <span className="z-10 mt-1 h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-background" />
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{label(event.status)}</span><span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString("en-IN")}</span></div><div className="text-xs text-muted-foreground">{event.actor_role ?? "system"}{event.note ? ` · ${event.note}` : ""}{i > 0 ? ` · ${duration(sorted[i - 1].created_at, event.created_at)} since previous` : ""}</div></div>
    </div>
  ))}</div>;
}

function DispatchCenter() {
  const q = useDispatchCenter();
  const reassign = useAdminReassignDelivery();
  const resolve = useResolveDeliveryException();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const data = q.data;
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.assignments ?? []).filter(a => (filter === "all" || a.status === filter) && (!term || [a.id, a.order_id, a.order?.order_number, a.order?.buyer_name, a.partner?.full_name, a.partner_id, a.order?.seller_id].some(v => String(v ?? "").toLowerCase().includes(term))));
  }, [data, filter, search]);
  const active = (data?.assignments ?? []).filter(a => !["delivered", "cancelled", "rejected", "expired", "reassigned"].includes(a.status));
  const selectedAssignment = (data?.assignments ?? []).find(a => a.id === selected) ?? rows[0];
  const selectedEvents = data?.tracking.filter(e => e.assignment_id === selectedAssignment?.id) ?? [];
  const chart = useMemo(() => {
    const grouped: Record<string, number> = {};
    (data?.exceptions ?? []).forEach(e => { const day = new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); grouped[day] = (grouped[day] ?? 0) + 1; });
    return Object.entries(grouped).slice(-14).map(([day, count]) => ({ day, count }));
  }, [data?.exceptions]);
  const riderStats = useMemo(() => {
    const map = new Map<string, { name: string; completed: number; failed: number; accepted: number; requests: number; earnings: number }>();
    (data?.assignments ?? []).forEach(a => { if (!a.partner) return; const old = map.get(a.partner_id) ?? { name: a.partner.full_name, completed: 0, failed: 0, accepted: 0, requests: a.partner.total_requests, earnings: 0 }; old.completed += a.status === "delivered" ? 1 : 0; old.failed += ["cancelled", "rejected", "expired", "failed"].includes(a.status) ? 1 : 0; old.accepted += ["accepted", "navigating_to_vendor", "reached_vendor", "picked_up", "out_for_delivery", "delivered"].includes(a.status) ? 1 : 0; map.set(a.partner_id, old); });
    (data?.earnings ?? []).forEach((e: any) => { const s = map.get(e.partner_id); if (s) s.earnings += Number(e.amount ?? 0); });
    return [...map.entries()].map(([id, s]) => ({ id, ...s, acceptance: s.requests ? Math.round(s.accepted / s.requests * 100) : 0 })).sort((a, b) => b.completed - a.completed || b.earnings - a.earnings).slice(0, 8);
  }, [data]);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Dispatch control center</h1><p className="text-sm text-muted-foreground">Live assignments, rider health, timeline, and exceptions.</p></div><Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} className="gap-2"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
    {q.error && <Card className="border-destructive/40"><CardContent className="flex items-center gap-2 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />Could not load dispatch data. Check admin access and migration status.</CardContent></Card>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric icon={Truck} label="Active deliveries" value={active.length} /><Metric icon={UserRound} label="Online riders" value={(data?.assignments ?? []).filter(a => a.partner?.availability === "online").map(a => a.partner_id).filter((v, i, arr) => arr.indexOf(v) === i).length} /><Metric icon={AlertTriangle} label="Open exceptions" value={(data?.exceptions ?? []).filter(e => e.resolution_status === "open").length} /><Metric icon={Clock3} label="Completed" value={(data?.assignments ?? []).filter(a => a.status === "delivered").length} /></div>
    <Card><CardContent className="flex flex-col gap-3 p-3 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order, customer, rider, seller, assignment" className="pl-8" /></div><select aria-label="Filter delivery status" value={filter} onChange={e => setFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm capitalize">{statuses.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : label(s)}</option>)}</select></CardContent></Card>
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <Card><CardHeader><CardTitle className="text-base">Live assignments ({rows.length})</CardTitle></CardHeader><CardContent className="p-0"><div className="divide-y divide-border">{q.isLoading ? <div className="p-6 text-sm text-muted-foreground">Loading assignments…</div> : rows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No matching assignments.</div> : rows.map(a => <AssignmentRow key={a.id} assignment={a} selected={a.id === selectedAssignment?.id} onSelect={() => setSelected(a.id)} onReassign={() => reassign.mutate(a.id, { onSuccess: () => toast.success("Delivery reassigned"), onError: e => toast.error(e.message) })} busy={reassign.isPending} />)}</div></CardContent></Card>
      <div className="space-y-4"><Card><CardHeader><CardTitle className="text-base">Delivery timeline</CardTitle></CardHeader><CardContent>{selectedAssignment ? <><div className="mb-4 rounded-lg bg-muted/50 p-3 text-sm"><div className="font-semibold">{selectedAssignment.order?.order_number ?? selectedAssignment.order_id.slice(0, 8)}</div><div className="text-muted-foreground">{selectedAssignment.partner?.full_name ?? "Unassigned"} · {label(selectedAssignment.status)}</div></div><Timeline events={selectedEvents} /></> : <p className="text-sm text-muted-foreground">Select an assignment.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Latest rider location</CardTitle></CardHeader><CardContent>{selectedAssignment?.partner?.current_latitude && selectedAssignment.partner.current_longitude ? <><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="h-4 w-4" />Updated {new Date(selectedAssignment.partner.location_updated_at ?? Date.now()).toLocaleString("en-IN")}</div><iframe title="Latest rider location" className="h-48 w-full rounded-lg border" loading="lazy" src={`https://www.openstreetmap.org/export/embed.html?layer=mapnik&marker=${selectedAssignment.partner.current_latitude}%2C${selectedAssignment.partner.current_longitude}&bbox=${selectedAssignment.partner.current_longitude - .02}%2C${selectedAssignment.partner.current_latitude - .02}%2C${selectedAssignment.partner.current_longitude + .02}%2C${selectedAssignment.partner.current_latitude + .02}`} /></> : <p className="text-sm text-muted-foreground">No fresh GPS fix for this rider.</p>}</CardContent></Card></div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Rider performance</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2">Rider</th><th className="pb-2">Acceptance</th><th className="pb-2">Done</th><th className="pb-2">Failed</th><th className="pb-2 text-right">Earnings</th></tr></thead><tbody>{riderStats.map(r => <tr key={r.id} className="border-b last:border-0"><td className="py-2 font-medium">{r.name}</td><td>{r.acceptance}%</td><td>{r.completed}</td><td>{r.failed}</td><td className="text-right">₹{r.earnings.toLocaleString("en-IN")}</td></tr>)}</tbody></table>{riderStats.length === 0 && <p className="py-5 text-sm text-muted-foreground">No rider performance data.</p>}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Exception trend</CardTitle></CardHeader><CardContent className="h-56">{chart.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" name="Exceptions" fill="var(--chart-1)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-muted-foreground">No exceptions recorded.</div>}</CardContent></Card></div>
    <Card><CardHeader><CardTitle className="text-base">Delivery exceptions</CardTitle></CardHeader><CardContent className="space-y-2">{(data?.exceptions ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No exceptions recorded.</p> : data?.exceptions.map(e => <div key={e.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2 font-medium">{label(e.reason)} <Badge variant={e.resolution_status === "open" ? "destructive" : "outline"}>{label(e.resolution_status)}</Badge></div><div className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("en-IN")} · {e.notes || "No notes"}</div></div>{e.resolution_status === "open" && <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: e.id, status: "resolved", note: "Resolved by admin" }, { onSuccess: () => toast.success("Exception resolved"), onError: err => toast.error(err.message) })}>Resolve</Button>}</div>)}</CardContent></Card>
  </div>;
}

function AssignmentRow({ assignment: a, selected, onSelect, onReassign, busy }: { assignment: DispatchAssignment; selected: boolean; onSelect: () => void; onReassign: () => void; busy: boolean }) { const closed = ["delivered", "cancelled", "rejected", "expired", "reassigned"].includes(a.status); return <button type="button" onClick={onSelect} className={`grid w-full gap-2 p-3 text-left transition hover:bg-muted/50 ${selected ? "bg-primary/5" : ""}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{a.order?.order_number ?? `#${a.order_id.slice(0, 8)}`}</span><Badge variant={a.status === "delivered" ? "default" : "outline"} className="capitalize">{label(a.status)}</Badge></div><div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3"><span>{a.order?.buyer_name ?? "Customer unavailable"}</span><span>{a.partner?.full_name ?? "Unassigned"} · <span className={a.partner?.availability === "online" ? "text-emerald-600" : "text-muted-foreground"}>{a.partner?.availability ?? "offline"}</span></span><span>{a.partner?.current_latitude ? "GPS fresh" : "No GPS"}</span></div>{!closed && <span className="flex items-center justify-end"><Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={e => { e.stopPropagation(); onReassign(); }}>Reassign rider</Button></span>}</button>; }
function Metric({ icon: Icon, label, value }: { icon: typeof Truck; label: string; value: number }) { return <Card><CardContent className="flex items-center gap-3 p-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div><div><div className="text-xl font-black">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div></CardContent></Card>; }
