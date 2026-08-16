import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBroadcasts, useSendBroadcast } from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({
    meta: [{ title: "Notifications — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const q = useBroadcasts();
  const send = useSendBroadcast();
  const [form, setForm] = useState({
    title: "",
    body: "",
    channel: "in_app" as const,
    audience: "all_users" as const,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Broadcast to users and vendors via in-app, email, or push.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compose broadcast</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea
                rows={4}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Channel</Label>
                <Select
                  value={form.channel}
                  onValueChange={(v) => setForm({ ...form, channel: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_app">In-app</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="push">Push</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Audience</Label>
                <Select
                  value={form.audience}
                  onValueChange={(v) => setForm({ ...form, audience: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_users">All users</SelectItem>
                    <SelectItem value="all_vendors">All vendors</SelectItem>
                    <SelectItem value="selected_users">Selected users</SelectItem>
                    <SelectItem value="selected_vendors">Selected vendors</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="w-full gap-1"
              onClick={() => {
                if (!form.title || !form.body) return toast.error("Title and message are required");
                send.mutate({ ...form, target_ids: [] } as any, {
                  onSuccess: () => {
                    toast.success("Broadcast sent");
                    setForm({ title: "", body: "", channel: "in_app", audience: "all_users" });
                  },
                });
              }}
              disabled={send.isPending}
            >
              <Send className="h-4 w-4" />
              Send
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent broadcasts</CardTitle>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            ) : (q.data ?? []).length === 0 ? (
              <div className="grid place-items-center py-8 text-sm text-muted-foreground">
                No broadcasts yet.
              </div>
            ) : (
              <ul className="space-y-3">
                {(q.data ?? []).slice(0, 10).map((b) => (
                  <li key={b.id} className="border-b border-border pb-2 last:border-none">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{b.title}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {b.channel}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {b.audience.replace("_", " ")}
                      </Badge>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {new Date(b.sent_at).toLocaleString("en-IN")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{b.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
