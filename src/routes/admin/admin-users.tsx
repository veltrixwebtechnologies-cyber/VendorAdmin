import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, Search, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADMIN_PERMISSION_LABELS,
  ADMIN_ROLE_LABELS,
  ADMIN_ROLES,
  adminErrorMessage,
  adminPermissionsForRole,
  type AdminRole,
  useAdminAccess,
} from "@/shared/auth/admin-permissions";
import {
  useAdminAssignments,
  useFindAdminAccount,
  useSetAdminAccess,
} from "@/shared/auth/admin-rbac";

export const Route = createFileRoute("/admin/admin-users")({
  head: () => ({
    meta: [{ title: "Admin Users — LocalShore Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const usersQuery = useAdminAssignments();
  const adminAccess = useAdminAccess();
  const findAccount = useFindAdminAccount();
  const setAccess = useSetAdminAccess();
  const canManageAdmins = adminAccess.hasPermission("admins.manage");
  const [email, setEmail] = useState("");
  const [candidate, setCandidate] = useState<{
    user_id: string;
    email: string | null;
    display_name: string | null;
  } | null>(null);
  const [role, setRole] = useState<AdminRole>("SUPPORT_AGENT");
  const [status, setStatus] = useState<"active" | "suspended">("active");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const currentAssignment = useMemo(
    () => usersQuery.data?.find((item) => item.user_id === candidate?.user_id),
    [candidate?.user_id, usersQuery.data],
  );

  const searchAccount = async () => {
    if (!email.trim()) return toast.error("Enter the account email first.");
    try {
      const result = await findAccount.mutateAsync(email);
      if (!result) {
        setCandidate(null);
        toast.error("No LocalShore account was found for that email.");
        return;
      }
      setCandidate(result);
      setRole("SUPPORT_AGENT");
      setStatus("active");
      setReason("");
    } catch (error) {
      toast.error(adminErrorMessage(error, "Could not search for the account."));
    }
  };

  const selectExisting = (userId: string) => {
    const row = usersQuery.data?.find((item) => item.user_id === userId);
    if (!row) return;
    setCandidate({ user_id: row.user_id, email: row.email, display_name: row.display_name });
    setEmail(row.email ?? "");
    setRole(row.role);
    setStatus(row.status);
    setReason("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveAccess = async () => {
    if (!candidate) return;
    try {
      await setAccess.mutateAsync({ userId: candidate.user_id, role, status, reason });
      toast.success("Admin access updated. The change is recorded in the audit log.");
      setConfirmOpen(false);
      setCandidate(null);
      setReason("");
    } catch (error) {
      toast.error(adminErrorMessage(error, "Could not update admin access."));
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Admin users</h1>
        <p className="text-sm text-muted-foreground">
          Assign least-privilege roles to existing LocalShore accounts. Access changes require a
          reason and are audited.
        </p>
      </header>

      {canManageAdmins && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" /> Assign or update admin access
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="admin-account-email">Existing account email</Label>
                <Input
                  id="admin-account-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <Button
                className="self-end gap-2"
                onClick={() => void searchAccount()}
                disabled={findAccount.isPending}
              >
                {findAccount.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Find account
              </Button>
            </div>

            {candidate && (
              <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Account</Label>
                  <p className="rounded-md bg-muted px-3 py-2 text-sm">
                    {candidate.display_name || "LocalShore user"} · {candidate.email}
                    {currentAssignment && (
                      <Badge className="ml-2" variant="outline">
                        Current admin
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-role">Role</Label>
                  <select
                    id="admin-role"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={role}
                    onChange={(event) => setRole(event.target.value as AdminRole)}
                  >
                    {ADMIN_ROLES.map((item) => (
                      <option key={item} value={item}>
                        {ADMIN_ROLE_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-status">Access status</Label>
                  <select
                    id="admin-status"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as "active" | "suspended")}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-reason">Reason for change</Label>
                  <Input
                    id="admin-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Required for audit history"
                  />
                </div>
                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Role permissions preview
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {adminPermissionsForRole(role).map((permission) => (
                      <Badge key={permission} variant="secondary" className="font-normal">
                        {ADMIN_PERMISSION_LABELS[permission]}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  className="md:col-span-2"
                  disabled={reason.trim().length < 3}
                  onClick={() => setConfirmOpen(true)}
                >
                  Review access change
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assigned administrators</CardTitle>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : usersQuery.isError ? (
            <div className="space-y-3 text-sm">
              <p className="text-destructive">
                Could not load admin accounts.{" "}
                {adminErrorMessage(usersQuery.error, "Access may be unavailable for this role.")}
              </p>
              <Button variant="outline" size="sm" onClick={() => void usersQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : (usersQuery.data?.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No admin assignments are available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">Name / email</th>
                    <th className="p-2">Role</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Last login</th>
                    <th className="p-2">Assigned</th>
                    {canManageAdmins && <th className="p-2">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {usersQuery.data?.map((row) => (
                    <tr key={row.user_id} className="border-t border-border">
                      <td className="p-2">
                        <div className="font-medium">{row.display_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </td>
                      <td className="p-2">{ADMIN_ROLE_LABELS[row.role]}</td>
                      <td className="p-2">
                        <Badge variant={row.status === "active" ? "default" : "destructive"}>
                          {row.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs">
                        {row.last_sign_in_at
                          ? new Date(row.last_sign_in_at).toLocaleString()
                          : "Never"}
                      </td>
                      <td className="p-2 text-xs">
                        {new Date(row.created_at).toLocaleDateString()}
                      </td>
                      {canManageAdmins && (
                        <td className="p-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectExisting(row.user_id)}
                          >
                            Manage
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManageAdmins && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex gap-3 p-4 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Admin roles are granted to existing authenticated accounts; creating/inviting Auth
              users is not supported by the current server architecture. The final active Super
              Admin cannot suspend or demote themselves as the only Super Admin.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm admin access change</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <p>
              <strong>{candidate?.email}</strong> will have{" "}
              <strong>{ADMIN_ROLE_LABELS[role]}</strong> access ({status}).
            </p>
            <p className="text-muted-foreground">Reason: {reason}</p>
            <p className="text-xs text-muted-foreground">
              This change is protected by backend permission checks and written to the audit log.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveAccess()} disabled={setAccess.isPending}>
              {setAccess.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
