import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut, Moon, Sun, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin-sidebar";
import { useAuth, signOut } from "@/lib/auth";
import { useIsAdmin } from "@/lib/db";
import { useTheme } from "@/lib/theme";
import { NotificationsBell } from "@/components/notifications-bell";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Console — Seller Hub" },
      { name: "description", content: "Multi-vendor marketplace admin dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading } = useAuth();
  const isAdminQ = useIsAdmin();
  const { mode, toggle } = useTheme();

  const onLogin = pathname === "/admin/login";
  const notReady = loading || (!!user && isAdminQ.isLoading);

  useEffect(() => {
    if (onLogin || loading) return;
    if (!user || (!isAdminQ.isLoading && !isAdminQ.data)) {
      navigate({ to: "/admin/login", replace: true });
    }
  }, [onLogin, loading, user, isAdminQ.isLoading, isAdminQ.data, navigate]);

  if (onLogin) return <Outlet />;
  if (notReady)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading admin console…
      </div>
    );
  if (!user || !isAdminQ.data) return null;

  const initial = (user.email?.[0] ?? "A").toUpperCase();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AdminSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background/80 px-2 backdrop-blur sm:gap-2 sm:px-4">
            <SidebarTrigger className="shrink-0" />
            <div className="relative hidden max-w-md flex-1 md:block">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search users, vendors, products, orders…" className="pl-8 h-9" />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label="Toggle theme"
                className="h-9 w-9"
              >
                {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <NotificationsBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:px-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback>{initial}</AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-[160px] truncate text-xs font-medium lg:inline">
                      {user.email}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate({ to: "/admin/settings" })}>
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      await signOut();
                      navigate({ to: "/admin/login" });
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6 animate-fade-in">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
