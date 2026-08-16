import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Store,
  Package,
  FolderTree,
  ShoppingCart,
  CreditCard,
  Wallet,
  Boxes,
  Star,
  Ticket,
  Image as ImageIcon,
  BarChart3,
  LifeBuoy,
  Bell,
  Settings,
  Radio,
  Sparkles,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const NAV = [
  {
    group: "Overview",
    items: [{ title: "Dashboard", url: "/admin", icon: LayoutDashboard, exact: true }],
  },
  {
    group: "Marketplace",
    items: [
      { title: "Users", url: "/admin/users", icon: Users },
      { title: "Vendors", url: "/admin/vendors", icon: Store },
      { title: "Products", url: "/admin/products", icon: Package },
      { title: "Categories", url: "/admin/categories", icon: FolderTree },
      { title: "Orders", url: "/admin/orders", icon: ShoppingCart },
      { title: "Inventory", url: "/admin/inventory", icon: Boxes },
      { title: "Reviews", url: "/admin/reviews", icon: Star },
    ],
  },
  {
    group: "Finance",
    items: [
      { title: "Payments", url: "/admin/payments", icon: CreditCard },
      { title: "Vendor Payouts", url: "/admin/payouts", icon: Wallet },
    ],
  },
  {
    group: "Growth",
    items: [
      { title: "Coupons & Promotions", url: "/admin/coupons", icon: Ticket },
      { title: "Merchandising", url: "/admin/merchandising", icon: Sparkles },
      { title: "Banner Management", url: "/admin/banners", icon: ImageIcon },
      { title: "Reports", url: "/admin/reports", icon: BarChart3 },
    ],
  },
  {
    group: "Operations",
    items: [
      { title: "Dispatch", url: "/admin/dispatch", icon: Radio },
      { title: "Support Tickets", url: "/admin/tickets", icon: LifeBuoy },
      { title: "Notifications", url: "/admin/notifications", icon: Bell },
      { title: "Settings", url: "/admin/settings", icon: Settings },
    ],
  },
] as const;

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string, exact?: boolean) =>
    exact ? path === url : path === url || path.startsWith(url + "/");
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/admin" className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground font-black">
            S
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">Seller Hub</div>
              <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                Admin Console
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((g) => (
          <SidebarGroup key={g.group}>
            {!collapsed && <SidebarGroupLabel>{g.group}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = isActive(item.url, (item as any).exact);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="truncate">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
