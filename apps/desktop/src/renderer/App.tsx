import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useAuthStore } from './store/authStore';
import { useAppStore } from './store/appStore';
import { Layout } from './components/Layout';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { FuelSales } from './screens/FuelSales';
import { NonFuelPOS } from './screens/NonFuelPOS';
import { ShiftManagement } from './screens/ShiftManagement';
import { MeterReadings } from './screens/MeterReadings';
import { Customers } from './screens/Customers';
import { Products } from './screens/Products';
import './index.css';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Branch Selector Component
const BranchSelector: React.FC = () => {
  const { currentBranch, setCurrentBranch } = useAppStore();
  const [branches, setBranches] = React.useState([]);

  React.useEffect(() => {
    // Fetch branches on mount
    import('./api/endpoints').then(({ branchesApi }) => {
      branchesApi.getAll().then((response) => {
        setBranches(response.data);
        if (response.data.length > 0 && !currentBranch) {
          setCurrentBranch(response.data[0]);
        }
      });
    });
  }, [currentBranch, setCurrentBranch]);

  return null;
};

// Online/Offline Detector
const OnlineDetector: React.FC = () => {
  const { setIsOnline } = useAppStore();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline]);

  return null;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OnlineDetector />
        <BranchSelector />
        <Toaster position="top-right" richColors />

        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/fuel-sales"
            element={
              <ProtectedRoute>
                <Layout>
                  <FuelSales />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/non-fuel-pos"
            element={
              <ProtectedRoute>
                <Layout>
                  <NonFuelPOS />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/shifts"
            element={
              <ProtectedRoute>
                <Layout>
                  <ShiftManagement />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/meter-readings"
            element={
              <ProtectedRoute>
                <Layout>
                  <MeterReadings />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Additional screens */}
          <Route
            path="/customers"
            element={
              <ProtectedRoute>
                <Layout>
                  <Customers />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <Layout>
                  <Products />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Layout>
                  <div className="text-center py-12">
                    <h2 className="text-2xl font-bold">Reports</h2>
                    <p className="text-slate-600 mt-2">Screen under construction</p>
                  </div>
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/bifurcation"
            element={
              <ProtectedRoute>
                <Layout>
                  <div className="text-center py-12">
                    <h2 className="text-2xl font-bold">Bifurcation</h2>
                    <p className="text-slate-600 mt-2">Screen under construction</p>
                  </div>
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout>
                  <div className="text-center py-12">
                    <h2 className="text-2xl font-bold">Settings</h2>
                    <p className="text-slate-600 mt-2">Screen under construction</p>
                  </div>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};
