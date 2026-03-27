import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './navigation/AppNavigator';
import { useAuthStore } from './store/authStore';
import { useOfflineStore } from './store/offlineStore';
import { setupNetworkListener } from './utils/offline';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    },
  },
});

const App: React.FC = () => {
  const { loadStoredAuth } = useAuthStore();
  const { loadPendingReadings } = useOfflineStore();

  useEffect(() => {
    // Load stored authentication
    loadStoredAuth();

    // Load pending offline readings
    loadPendingReadings();

    // Setup network listener for offline support
    const unsubscribe = setupNetworkListener();

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppNavigator />
        <StatusBar style="light" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
};

export default App;
