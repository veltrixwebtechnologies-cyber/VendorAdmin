import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMyNotifications,
} from "@/shared/notifications/seller-events";

export const Route = createFileRoute("/seller/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Seller Hub" }] }),
  component: NotificationCenter,
});

function NotificationCenter() {
  const query = useMyNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const notifications = query.data ?? [];
  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Orders, stock, settlements, reviews and LocalShore announcements.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={unread === 0 || markAllRead.isPending}
          onClick={() => void markAllRead.mutateAsync()}
        >
          <CheckCheck className="h-4 w-4" /> Mark all read
        </Button>
      </div>
      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : query.isError ? (
        <Card className="border-destructive/30">
          <CardContent className="py-10 text-center">
            <p>Notifications could not be loaded.</p>
            <Button variant="outline" className="mt-3" onClick={() => void query.refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Bell className="mx-auto h-9 w-9 text-muted-foreground/50" />
            <p className="mt-3 font-medium">You’re all caught up</p>
            <p className="text-sm text-muted-foreground">
              Important seller updates will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const content = (
              <Card className={!notification.readAt ? "border-primary/30 bg-primary/[0.03]" : ""}>
                <CardContent className="flex gap-3 p-4">
                  <div className="mt-1 rounded-full bg-primary/10 p-2 text-primary">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{notification.title}</h2>
                      {!notification.readAt && <Badge>New</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                    <time className="mt-2 block text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(notification.createdAt))}
                    </time>
                  </div>
                </CardContent>
              </Card>
            );
            const read = () => !notification.readAt && markRead.mutate(notification.id);
            return notification.link ? (
              <Link key={notification.id} to={notification.link as any} onClick={read}>
                {content}
              </Link>
            ) : (
              <button
                key={notification.id}
                type="button"
                className="block w-full text-left"
                onClick={read}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
