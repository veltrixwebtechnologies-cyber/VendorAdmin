import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  BarChart3,
  Box,
  ClipboardList,
  Clock,
  Home,
  Lock,
  LogOut,
  MessageSquare,
  Package,
  Settings,
  ShoppingBag,
  Star,
  Store,
  Wallet,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/notifications-bell";
import { useAuth, signOut } from "@/lib/auth";
import { useMySeller } from "@/lib/db";

export const Route = createFileRoute("/seller")({
  head: () => ({
    meta: [
      { title: "Seller Dashboard — Seller Hub" },
      { name: "description", content: "Manage your store, products, orders and settlements." },
      { property: "og:title", content: "Seller Dashboard — Seller Hub" },
      {
        property: "og:description",
        content: "Manage your store, products, orders and settlements.",
      },
    ],
  }),
  component: SellerLayout,
});

const NAV = [
  { url: "/seller", label: "Dashboard", icon: Home, exact: true },
  { url: "/seller/store", label: "Store Setup", icon: Store },
  { url: "/seller/hours", label: "Shop Hours", icon: Clock },
  { url: "/seller/products", label: "Products", icon: Package },
  { url: "/seller/orders", label: "Orders", icon: ShoppingBag },
  { url: "/seller/inventory", label: "Inventory", icon: Box },
  { url: "/seller/settlements", label: "Settlements", icon: Wallet },
  { url: "/seller/analytics", label: "Analytics", icon: BarChart3 },
  { url: "/seller/reviews", label: "Reviews", icon: Star },
  { url: "/seller/reports", label: "Reports", icon: ClipboardList },
  { url: "/seller/profile", label: "Profile", icon: Settings },
];

function SellerLayout() {
  const { user, loading } = useAuth();
  const sellerQ = useMySeller();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const initialPath = useRef(pathname);

  useEffect(() => {
    if (!loading && !user) {
      const target = initialPath.current.startsWith("/seller") ? initialPath.current : "/seller";
      navigate({ to: "/auth", search: { redirect: target }, replace: true });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    // Store Setup is the onboarding entry point. Other seller operations stay
    // locked until an admin approves the application.
    if (!loading && user && !sellerQ.isLoading) {
      if (!sellerQ.data) {
        navigate({ to: "/register", replace: true });
      } else if (
        sellerQ.data.status !== "approved" &&
        pathname !== "/seller" &&
        pathname !== "/seller/store"
      ) {
        navigate({ to: "/register", replace: true });
      }
    }
  }, [user, loading, sellerQ.data, sellerQ.isLoading, pathname, navigate]);

  if (loading || !user || sellerQ.isLoading) {
    return (
      <div className="grid min-h-svh place-items-center bg-background text-sm text-muted-foreground">
        Loading your dashboard…
      </div>
    );
  }

  if (!sellerQ.data) {
    return (
      <div className="grid min-h-svh place-items-center bg-background p-4 text-center">
        <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
            <Store className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-foreground">No Shop Profile Found</h2>
          <p className="text-sm text-muted-foreground">
            Your seller shop profile or account does not exist or has been deleted.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link to="/register">
              <Button>Create New Shop</Button>
            </Link>
            <Button
              variant="outline"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const email = user.email ?? "";
  const initial = (email[0] ?? "S").toUpperCase();

  return (
    <SidebarProvider>
      <SellerSidebar />
      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-background/70 px-3 backdrop-blur sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <SidebarTrigger />
            <Link to="/" className="truncate text-sm text-muted-foreground hover:text-foreground">
              Seller Hub
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-sm sm:gap-3">
            <NotificationsBell />
            <div className="hidden items-center gap-2 md:flex">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initial}
              </div>
              <span className="text-muted-foreground max-w-[180px] truncate">{email}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-3"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-6">
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  );
}

function SellerSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sellerQ = useMySeller();
  const isApproved = sellerQ.data?.status === "approved";
  const isActive = (url: string, exact?: boolean) =>
    exact ? pathname === url : pathname === url || pathname.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/seller" className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
            S
          </div>
          <span className="font-semibold">Seller Hub</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const Icon = item.icon;
                const isLocked =
                  !isApproved &&
                  item.url !== "/seller" &&
                  item.url !== "/seller/store" &&
                  item.url !== "/seller/profile";
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url, item.exact)}
                      className={isLocked ? "opacity-60" : ""}
                    >
                      <Link to={isLocked ? "/seller" : item.url}>
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{item.label}</span>
                        {isLocked && <Lock className="ml-auto h-3 w-3 text-muted-foreground" />}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/seller/support">
                    <MessageSquare className="h-4 w-4" />
                    <span>Support</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
