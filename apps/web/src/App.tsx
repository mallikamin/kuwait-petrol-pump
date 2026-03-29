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
import { Sales } from '@/pages/Sales';
import { Customers } from '@/pages/Customers';
import { Products } from '@/pages/Products';
import { Bifurcation } from '@/pages/Bifurcation';
import { Reports } from '@/pages/Reports';
import { Users } from '@/pages/Users';
import { POS } from '@/pages/POS';
import QuickBooks from '@/pages/QuickBooks';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
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
            <Route path="shifts" element={<Shifts />} />
            <Route path="meter-readings" element={<MeterReadings />} />
            <Route path="sales" element={<Sales />} />
            <Route path="customers" element={<Customers />} />
            <Route path="products" element={<Products />} />
            <Route path="bifurcation" element={<Bifurcation />} />
            <Route path="reports" element={<Reports />} />
            <Route path="quickbooks" element={<QuickBooks />} />
            <Route path="users" element={<Users />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
