import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Fuel,
  ShoppingCart,
  Clock,
  Gauge,
  Users,
  Package,
  FileText,
  Calculator,
  Settings,
  LogOut,
  WifiOff,
  Wifi,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useAppStore } from '../store/appStore';
import { cn } from '../utils/cn';
import { getRoleLabel } from '../utils/format';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { currentBranch, currentShift, isOnline } = useAppStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['admin', 'manager', 'cashier', 'operator', 'accountant'] },
    { name: 'Fuel Sales', href: '/fuel-sales', icon: Fuel, roles: ['admin', 'manager', 'cashier', 'operator'] },
    { name: 'Non-Fuel POS', href: '/non-fuel-pos', icon: ShoppingCart, roles: ['admin', 'manager', 'cashier'] },
    { name: 'Shift Management', href: '/shifts', icon: Clock, roles: ['admin', 'manager', 'cashier', 'operator'] },
    { name: 'Meter Readings', href: '/meter-readings', icon: Gauge, roles: ['admin', 'manager', 'operator'] },
    { name: 'Customers', href: '/customers', icon: Users, roles: ['admin', 'manager', 'cashier'] },
    { name: 'Products', href: '/products', icon: Package, roles: ['admin', 'manager'] },
    { name: 'Reports', href: '/reports', icon: FileText, roles: ['admin', 'manager', 'accountant'] },
    { name: 'Bifurcation', href: '/bifurcation', icon: Calculator, roles: ['admin', 'manager', 'accountant'] },
  ];

  const filteredNavigation = navigation.filter((item) =>
    user ? item.roles.includes(user.role) : false
  );

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <div className="flex w-64 flex-col bg-slate-900">
        {/* Logo */}
        <div className="flex h-16 items-center justify-center border-b border-slate-700 px-4">
          <h1 className="text-xl font-bold text-white">Kuwait Petrol POS</h1>
        </div>

        {/* User Info */}
        <div className="border-b border-slate-700 p-4">
          <div className="text-sm font-medium text-white">{user?.name}</div>
          <div className="text-xs text-slate-400">{user && getRoleLabel(user.role)}</div>
          {currentBranch && (
            <div className="mt-2 text-xs text-slate-400">
              Branch: {currentBranch.name}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {filteredNavigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="border-t border-slate-700 p-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-4">
            {currentShift && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-1.5 text-sm">
                <div className="h-2 w-2 rounded-full bg-green-600 animate-pulse" />
                <span className="font-medium text-green-900">
                  Shift Active: {currentShift.shift.name}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Online Status */}
            <div className="flex items-center gap-2">
              {isOnline ? (
                <>
                  <Wifi className="h-5 w-5 text-green-600" />
                  <span className="text-sm text-slate-600">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-5 w-5 text-red-600" />
                  <span className="text-sm text-red-600">Offline</span>
                </>
              )}
            </div>

            {/* Settings */}
            <Link
              to="/settings"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
};
