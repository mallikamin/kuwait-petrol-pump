import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Fuel,
  Clock,
  Gauge,
  ShoppingCart,
  Users,
  Package,
  Calculator,
  FileText,
  Settings,
  ChevronLeft,
  ChevronDown,
  CreditCard,
  Link2,
  Truck,
  ShoppingCart as ShoppingBag,
  CalendarClock,
  Receipt,
  Banknote,
  Wrench,
  Droplets,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/store/auth';
import { UserRole } from '@/types';

interface NavLeaf {
  title: string;
  href: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

interface NavGroup {
  kind: 'group';
  title: string;
  icon: React.ReactNode;
  roles?: UserRole[];
  children: NavLeaf[];
}

type NavItem = NavLeaf | NavGroup;

const setupGroup: NavGroup = {
  kind: 'group',
  title: 'Pump Setup',
  icon: <Wrench className="h-5 w-5" />,
  roles: ['admin', 'manager', 'accountant'],
  children: [
    { title: 'Branches', href: '/branches', icon: <Building2 className="h-4 w-4" />, roles: ['admin', 'manager', 'accountant'] },
    { title: 'Fuel Prices', href: '/fuel-prices', icon: <Fuel className="h-4 w-4" />, roles: ['admin', 'manager', 'accountant'] },
    { title: 'Nozzles', href: '/nozzles', icon: <Gauge className="h-4 w-4" />, roles: ['admin', 'manager', 'accountant'] },
    { title: 'Shifts', href: '/shifts', icon: <Clock className="h-4 w-4" /> },
    { title: 'Products', href: '/products', icon: <Package className="h-4 w-4" /> },
    { title: 'Suppliers', href: '/suppliers', icon: <Truck className="h-4 w-4" />, roles: ['admin', 'manager', 'accountant'] },
    { title: 'Customers', href: '/customers', icon: <Users className="h-4 w-4" /> },
  ],
};

// Client-specified order (2026-04-23). Pump Setup collapses 7 configuration
// pages under one lean parent so daily-use flows (POS, Meter Readings,
// Backdated Entries, Sales, Receipts, Expenses, Cash Recon) stay at the top
// level. All child routes are untouched — only the nav shape changed.
const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
  { title: 'POS', href: '/pos', icon: <CreditCard className="h-5 w-5" /> },
  setupGroup,
  { title: 'Meter Readings', href: '/meter-readings', icon: <Gauge className="h-5 w-5" /> },
  { title: 'Backdated Entries', href: '/backdated-entries2', icon: <CalendarClock className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Sales', href: '/sales', icon: <ShoppingCart className="h-5 w-5" /> },
  { title: 'Purchase Orders', href: '/purchase-orders', icon: <ShoppingBag className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Reconciliation', href: '/reconciliation', icon: <Calculator className="h-5 w-5" /> },
  { title: 'Receipts', href: '/receipts', icon: <Receipt className="h-5 w-5" />, roles: ['admin', 'accountant'] },
  { title: 'Expenses', href: '/expenses', icon: <Banknote className="h-5 w-5" /> },
  { title: 'Cash Reconciliation', href: '/cash-reconciliation', icon: <Calculator className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'PSO Top-Ups', href: '/pso-topups', icon: <CreditCard className="h-5 w-5" /> },
  { title: 'Gain / Loss', href: '/gain-loss', icon: <Droplets className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Reports', href: '/reports', icon: <FileText className="h-5 w-5" /> },
  { title: 'QuickBooks', href: '/quickbooks', icon: <Link2 className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Users', href: '/users', icon: <Settings className="h-5 w-5" />, roles: ['admin', 'accountant'] },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function hasRole(item: { roles?: UserRole[] }, role?: UserRole): boolean {
  if (!item.roles) return true;
  return !!role && item.roles.includes(role);
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const { user } = useAuthStore();

  const isGroupActive = setupGroup.children.some((c) => c.href === location.pathname);
  const [setupOpen, setSetupOpen] = useState<boolean>(isGroupActive);

  // Auto-expand the Setup group when the user navigates into any of its
  // routes (e.g. from a Reports drill-down or POS customer picker). The
  // user can still collapse it manually afterwards.
  useEffect(() => {
    if (isGroupActive) setSetupOpen(true);
  }, [isGroupActive]);

  const leafClass = (isActive: boolean) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      collapsed && 'justify-center',
    );

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex h-16 items-center justify-between border-b px-4">
        {!collapsed && <h1 className="text-xl font-bold text-primary">Petrol Pump POS Admin</h1>}
        <button
          onClick={onToggle}
          className="rounded-lg p-2 hover:bg-accent transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={cn('h-5 w-5 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-2 overflow-y-auto h-[calc(100vh-4rem)]">
        {navItems.map((item) => {
          if (!hasRole(item, user?.role)) return null;

          if ('kind' in item && item.kind === 'group') {
            const visibleChildren = item.children.filter((c) => hasRole(c, user?.role));
            if (visibleChildren.length === 0) return null;
            const isActive = visibleChildren.some((c) => c.href === location.pathname);

            // Collapsed sidebar: render children as flat icon-only links, with
            // no group chrome, so icons stay tap-targets (the group header
            // has nowhere to fold into when the rail is 16w).
            if (collapsed) {
              return visibleChildren.map((c) => (
                <Link
                  key={c.href}
                  to={c.href}
                  className={leafClass(location.pathname === c.href)}
                  title={c.title}
                >
                  {c.icon}
                </Link>
              ));
            }

            return (
              <div key={item.title}>
                <button
                  type="button"
                  onClick={() => setSetupOpen((v) => !v)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                  aria-expanded={setupOpen}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.title}</span>
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', !setupOpen && '-rotate-90')}
                  />
                </button>

                {setupOpen && (
                  <div className="mt-1 space-y-1 pl-3 border-l ml-4">
                    {visibleChildren.map((c) => (
                      <Link
                        key={c.href}
                        to={c.href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                          location.pathname === c.href
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        {c.icon}
                        <span>{c.title}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          const leaf = item as NavLeaf;
          const isActive = location.pathname === leaf.href;
          return (
            <Link
              key={leaf.href}
              to={leaf.href}
              className={leafClass(isActive)}
              title={collapsed ? leaf.title : undefined}
            >
              {leaf.icon}
              {!collapsed && <span>{leaf.title}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
