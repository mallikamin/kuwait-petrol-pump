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
  CreditCard,
  Link2,
  Truck,
  ShoppingCart as ShoppingBag,
  CalendarClock,
  Receipt,
  Banknote,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/store/auth';
import { UserRole } from '@/types';

interface NavItem {
  title: string;
  href: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
  { title: 'POS', href: '/pos', icon: <CreditCard className="h-5 w-5" /> },
  { title: 'Branches', href: '/branches', icon: <Building2 className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Fuel Prices', href: '/fuel-prices', icon: <Fuel className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Nozzles', href: '/nozzles', icon: <Gauge className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Shifts', href: '/shifts', icon: <Clock className="h-5 w-5" /> },
  { title: 'Meter Readings', href: '/meter-readings', icon: <Gauge className="h-5 w-5" /> },
  // { title: 'Backdated Entries', href: '/backdated-entries', icon: <CalendarClock className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] }, // V1 hidden temporarily
  { title: 'Backdated Entries', href: '/backdated-entries2', icon: <CalendarClock className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Sales', href: '/sales', icon: <ShoppingCart className="h-5 w-5" /> },
  { title: 'Customers', href: '/customers', icon: <Users className="h-5 w-5" /> },
  { title: 'Products', href: '/products', icon: <Package className="h-5 w-5" /> },
  { title: 'Suppliers', href: '/suppliers', icon: <Truck className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Purchase Orders', href: '/purchase-orders', icon: <ShoppingBag className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Reconciliation', href: '/reconciliation', icon: <Calculator className="h-5 w-5" /> },
  { title: 'Receipts', href: '/receipts', icon: <Receipt className="h-5 w-5" />, roles: ['admin', 'accountant'] },
  { title: 'Expenses', href: '/expenses', icon: <Banknote className="h-5 w-5" /> },
  { title: 'Cash Reconciliation', href: '/cash-reconciliation', icon: <Calculator className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'PSO Top-Ups', href: '/pso-topups', icon: <CreditCard className="h-5 w-5" /> },
  { title: 'Reports', href: '/reports', icon: <FileText className="h-5 w-5" /> },
  { title: 'QuickBooks', href: '/quickbooks', icon: <Link2 className="h-5 w-5" />, roles: ['admin', 'manager', 'accountant'] },
  { title: 'Users', href: '/users', icon: <Settings className="h-5 w-5" />, roles: ['admin', 'accountant'] },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const { user } = useAuthStore();

  const filteredItems = navItems.filter((item) => {
    if (!item.roles) return true;
    return user?.role && item.roles.includes(user.role);
  });

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
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
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.href;

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                collapsed && 'justify-center'
              )}
              title={collapsed ? item.title : undefined}
            >
              {item.icon}
              {!collapsed && <span>{item.title}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
