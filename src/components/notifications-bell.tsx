import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck, Package, ShoppingBag, Wallet, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMyNotifications,
  type Notification,
} from "@/lib/db";

export function NotificationsBell() {
  const q = useMyNotifications();
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();

  const openOne = (n: Notification) => {
    if (!n.readAt) markOne.mutate(n.id);
    if (n.link) navigate({ to: n.link });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <Badge className="absolute -right-1 -top-1 h-5 min-w-5 rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-medium">Notifications</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => openOne(n)}
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
                  >
                    <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <KindIcon kind={n.kind} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium">{n.title}</div>
                        {!n.readAt && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                        {timeAgo(n.createdAt)}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t p-2 text-center">
          <Link to="/seller" className="text-xs text-muted-foreground hover:text-foreground">
            Go to dashboard
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const C =
    kind === "order"
      ? ShoppingBag
      : kind === "stock"
        ? Package
        : kind === "payout"
          ? Wallet
          : UserCog;
  return <C className="h-4 w-4" />;
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  if (m < 1) return diff >= 0 ? "just now" : "soon";
  if (m < 60) return diff >= 0 ? `${m}m ago` : `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return diff >= 0 ? `${h}h ago` : `in ${h}h`;
  const d = Math.round(h / 24);
  return diff >= 0 ? `${d}d ago` : `in ${d}d`;
}
