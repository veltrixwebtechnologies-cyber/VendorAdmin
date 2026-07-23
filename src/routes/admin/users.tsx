import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Ban, CheckCircle2, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAdminUsers, useSetUserBlocked } from "@/lib/admin-db";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users — Admin" }, { name: "robots", content: "noindex" }] }),
  component: UsersPage,
});

function UsersPage() {
  const q = useAdminUsers();
  const block = useSetUserBlocked();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all"|"active"|"blocked">("all");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (filter !== "all") r = r.filter(u => filter === "blocked" ? u.is_blocked : !u.is_blocked);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter(u => (u.email ?? "").toLowerCase().includes(s) || (u.display_name ?? "").toLowerCase().includes(s));
    }
    return r;
  }, [q.data, search, filter]);
  const pages = Math.max(1, Math.ceil(rows.length/perPage));
  const p = Math.min(page, pages);
  const paged = rows.slice((p-1)*perPage, p*perPage);

  const toggle = (userId: string, blocked: boolean) => {
    block.mutate({ userId, blocked }, {
      onSuccess: () => toast.success(blocked ? "User blocked" : "User unblocked"),
      onError: (e: any) => toast.error(e.message || "Failed"),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Users</h1>
        <p className="text-sm text-muted-foreground">Manage customers who use the marketplace.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["all","active","blocked"] as const).map(f => (
          <Button key={f} size="sm" variant={filter===f?"default":"outline"} onClick={()=>{setFilter(f);setPage(1);}} className="rounded-full capitalize">{f}</Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search email or name" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} className="pl-8 h-9" />
        </div>
      </div>

      {q.isLoading ? <div className="grid gap-2">{Array.from({length:4}).map((_,i)=><div key={i} className="h-14 animate-pulse rounded-xl bg-muted"/>)}</div>
      : paged.length===0 ? <Card><CardContent className="grid place-items-center py-16 text-sm text-muted-foreground">No users found.</CardContent></Card>
      : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {paged.map(u => (
                <div key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:px-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{u.display_name || u.email || "Unknown"}</span>
                      {u.is_blocked && <Badge variant="destructive" className="text-[10px]">Blocked</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{u.email} · Joined {new Date(u.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="flex gap-2">
                    {u.is_blocked ? (
                      <Button size="sm" variant="outline" onClick={()=>toggle(u.id,false)} className="gap-1"><CheckCircle2 className="h-4 w-4"/>Unblock</Button>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="gap-1"><Ban className="h-4 w-4"/>Block</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Block this user?</AlertDialogTitle>
                            <AlertDialogDescription>They will lose the ability to place new orders. You can unblock later.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={()=>toggle(u.id,true)}>Block</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > perPage && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {(p-1)*perPage+1}-{Math.min(p*perPage, rows.length)} of {rows.length}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={p<=1} onClick={()=>setPage(p-1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={p>=pages} onClick={()=>setPage(p+1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
