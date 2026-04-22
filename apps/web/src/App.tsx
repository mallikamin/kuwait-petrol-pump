import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Layout } from '@/components/layout/Layout';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Branches } from '@/pages/Branches';
import { FuelPrices } from '@/pages/FuelPrices';
import { Shifts } from '@/pages/Shifts';
import { MeterReadings } from '@/pages/MeterReadings';
import { Nozzles } from '@/pages/Nozzles';
import { Sales } from '@/pages/Sales';
import { Customers } from '@/pages/Customers';
import { Products } from '@/pages/Products';
import { ReconciliationNew as Reconciliation } from '@/pages/ReconciliationNew';
import { Reports } from '@/pages/Reports';
import { Users } from '@/pages/Users';
import { POS } from '@/pages/POS';
import QuickBooks from '@/pages/QuickBooks';
import { Suppliers } from '@/pages/Suppliers';
import { PurchaseOrders } from '@/pages/PurchaseOrders';
import { BackdatedEntries } from '@/pages/BackdatedEntries';
import { BackdatedEntries2 } from '@/pages/BackdatedEntries2';
import { Credit } from '@/pages/Credit';
import { Expenses } from '@/pages/Expenses';
import { CashReconciliation } from '@/pages/CashReconciliation';
import { PsoTopups } from '@/pages/PsoTopups';
import { CustomerAdvance } from '@/pages/CustomerAdvance';
import { NotFound } from '@/pages/NotFound';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { useSessionKeepAlive } from '@/hooks/useSessionKeepAlive';
import { useEffect } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function App() {
  const { theme } = useThemeStore();

  // Proactively refresh the session while the user is authenticated so the
  // 24h access-token boundary never produces a mid-work logout.
  useSessionKeepAlive();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="pos" element={<POS />} />
            <Route path="branches" element={<Branches />} />
            <Route path="fuel-prices" element={<FuelPrices />} />
            <Route path="nozzles" element={<Nozzles />} />
            <Route path="shifts" element={<Shifts />} />
            <Route path="meter-readings" element={<MeterReadings />} />
            <Route path="backdated-entries" element={<BackdatedEntries />} />
            <Route path="backdated-entries2" element={<BackdatedEntries2 />} />
            <Route path="sales" element={<Sales />} />
            <Route path="customers" element={<Customers />} />
            <Route path="products" element={<Products />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="reconciliation" element={<Reconciliation />} />
            <Route path="receipts" element={<Credit />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="cash-reconciliation" element={<CashReconciliation />} />
            <Route path="pso-topups" element={<PsoTopups />} />
            <Route path="customer-advance" element={<CustomerAdvance />} />
            <Route path="reports" element={<Reports />} />
            <Route path="quickbooks" element={<QuickBooks />} />
            <Route path="users" element={<Users />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
