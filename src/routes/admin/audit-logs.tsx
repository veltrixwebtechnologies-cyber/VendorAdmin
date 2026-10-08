import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardList, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useAdminAuditLogs,
  type AdminAuditFilters,
  type AdminAuditLogRow,
} from "@/shared/auth/admin-rbac";
import { adminErrorMessage } from "@/shared/auth/admin-permissions";

export const Route = createFileRoute("/admin/audit-logs")({
  head: () => ({
    meta: [{ title: "Audit Logs — LocalShore Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminAuditLogsPage,
});

const EMPTY_FILTERS: AdminAuditFilters = {
  actor: "",
  action: "",
  resourceType: "",
  from: "",
  to: "",
  search: "",
  page: 1,
};

const ACTIONS = [
  "ADMIN_CREATED",
  "ADMIN_ROLE_CHANGED",
  "ADMIN_STATUS_CHANGED",
  "SELLER_APPROVED",
  "SELLER_REJECTED",
  "SELLER_SUSPENDED",
  "SELLER_STATUS_CHANGED",
  "STORE_UPDATED",
  "PRODUCT_APPROVED",
  "PRODUCT_REJECTED",
  "PRODUCT_UNPUBLISHED",
  "PRODUCT_UPDATED",
  "ORDER_STATUS_CHANGED",
  "CUSTOMER_BLOCKED",
  "CUSTOMER_UNBLOCKED",
  "COMMISSION_CHANGED",
  "SETTING_CHANGED",
  "PAYOUT_STATUS_CHANGED",
];

function displayAction(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function AuditLogDetails({ row }: { row: AdminAuditLogRow }) {
  const safeJson = (value: Record<string, unknown> | null) =>
    value ? JSON.stringify(value, null, 2) : "No previous value";
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{displayAction(row.action)}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Time:</span>{" "}
            {new Date(row.created_at).toLocaleString()}
          </p>
          <p>
            <span className="text-muted-foreground">Admin:</span>{" "}
            {row.actor_name || row.actor_email || row.actor_id || "System"}
          </p>
          <p>
            <span className="text-muted-foreground">Role:</span>{" "}
            {row.actor_role.replaceAll("_", " ")}
          </p>
          <p>
            <span className="text-muted-foreground">Resource:</span> {row.resource_type} /{" "}
            {row.resource_id || "—"}
          </p>
        </div>
        {row.reason && (
          <div>
            <p className="mb-1 font-medium">Reason</p>
            <p className="rounded-md bg-muted p-3">{row.reason}</p>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 font-medium">Before</p>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              {safeJson(row.previous_value)}
            </pre>
          </div>
          <div>
            <p className="mb-1 font-medium">After</p>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              {safeJson(row.new_value)}
            </pre>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

function AdminAuditLogsPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selected, setSelected] = useState<AdminAuditLogRow | null>(null);
  const query = useAdminAuditLogs(filters);
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (query.data?.pageSize ?? 25)));
  const update = <K extends keyof AdminAuditFilters>(key: K, value: AdminAuditFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Audit logs</h1>
        <p className="text-sm text-muted-foreground">
          Read-only history of privileged marketplace changes.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" /> Filter activity
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            aria-label="Search audit events"
            placeholder="Search action, resource ID, reason"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
          />
          <Input
            aria-label="Filter by admin"
            placeholder="Admin name, email or ID"
            value={filters.actor}
            onChange={(event) => update("actor", event.target.value)}
          />
          <select
            aria-label="Filter by action"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={filters.action}
            onChange={(event) => update("action", event.target.value)}
          >
            <option value="">All actions</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {displayAction(action)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by resource"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={filters.resourceType}
            onChange={(event) => update("resourceType", event.target.value)}
          >
            <option value="">All resources</option>
            {[
              "admin_access_assignments",
              "sellers",
              "products",
              "orders",
              "user_status",
              "platform_settings",
              "settlements",
            ].map((type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <Input
            aria-label="Start date"
            type="date"
            value={filters.from}
            onChange={(event) => update("from", event.target.value)}
          />
          <Input
            aria-label="End date"
            type="date"
            value={filters.to}
            onChange={(event) => update("to", event.target.value)}
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Activity{" "}
            <span className="ml-1 text-xs font-normal text-muted-foreground">{total} total</span>
          </CardTitle>
          {query.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent>
          {query.isError ? (
            <div className="space-y-3 py-8 text-center text-sm">
              <p className="text-destructive">
                Couldn’t load audit events.{" "}
                {adminErrorMessage(query.error, "Could not load audit logs.")}
              </p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </div>
          ) : query.isLoading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No audit activity matches these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">Timestamp</th>
                    <th className="p-2">Admin</th>
                    <th className="p-2">Role</th>
                    <th className="p-2">Action</th>
                    <th className="p-2">Resource</th>
                    <th className="p-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border hover:bg-muted/50"
                      onClick={() => setSelected(row)}
                    >
                      <td className="whitespace-nowrap p-2 text-xs">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="p-2">
                        <div>{row.actor_name || "Admin"}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.actor_email || row.actor_id || "—"}
                        </div>
                      </td>
                      <td className="p-2">
                        <Badge variant="outline">{row.actor_role.replaceAll("_", " ")}</Badge>
                      </td>
                      <td className="p-2">{displayAction(row.action)}</td>
                      <td className="p-2">
                        {row.resource_type}{" "}
                        <span className="text-xs text-muted-foreground">{row.resource_id}</span>
                      </td>
                      <td className="max-w-56 truncate p-2 text-xs text-muted-foreground">
                        {row.reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > 25 && (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
              <span>
                Page {filters.page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page <= 1}
                  onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page >= pages}
                  onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        {selected && <AuditLogDetails row={selected} />}
      </Dialog>
    </div>
  );
}
