import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePlatformSettings, useUpdateSettings } from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — Admin" }, { name: "robots", content: "noindex" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const q = usePlatformSettings();
  const upd = useUpdateSettings();
  const [form, setForm] = useState<any>({});
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Platform Settings</h1><p className="text-sm text-muted-foreground">Marketplace-wide configuration.</p></div>
      {q.isLoading ? <div className="h-64 animate-pulse rounded-xl bg-muted"/> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">General</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>Marketplace name</Label><Input value={form.marketplace_name||""} onChange={e=>setForm({...form, marketplace_name:e.target.value})}/></div>
              <div><Label>Logo URL</Label><Input value={form.logo_url||""} onChange={e=>setForm({...form, logo_url:e.target.value})}/></div>
              <div><Label>Payment gateway</Label><Input value={form.payment_gateway||""} onChange={e=>setForm({...form, payment_gateway:e.target.value})} placeholder="stripe / razorpay / paddle"/></div>
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Financials</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>Commission %</Label><Input type="number" value={form.commission_percent ?? 0} onChange={e=>setForm({...form, commission_percent: Number(e.target.value)})}/></div>
              <div><Label>Flat shipping (₹)</Label><Input type="number" value={form.shipping_flat ?? 0} onChange={e=>setForm({...form, shipping_flat: Number(e.target.value)})}/></div>
              <div><Label>Tax on fees %</Label><Input type="number" value={form.tax_percent ?? 0} onChange={e=>setForm({...form, tax_percent: Number(e.target.value)})}/></div>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Policies</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div><Label>Return policy</Label><Textarea rows={6} value={form.return_policy||""} onChange={e=>setForm({...form, return_policy:e.target.value})}/></div>
              <div><Label>Privacy policy</Label><Textarea rows={6} value={form.privacy_policy||""} onChange={e=>setForm({...form, privacy_policy:e.target.value})}/></div>
              <div><Label>Terms & conditions</Label><Textarea rows={6} value={form.terms_conditions||""} onChange={e=>setForm({...form, terms_conditions:e.target.value})}/></div>
            </CardContent>
          </Card>
          <div className="lg:col-span-2 flex justify-end">
            <Button onClick={()=>upd.mutate(form,{onSuccess:()=>toast.success("Saved"), onError:(e:any)=>toast.error(e.message)})} disabled={upd.isPending}>Save changes</Button>
          </div>
        </div>
      )}
    </div>
  );
}
