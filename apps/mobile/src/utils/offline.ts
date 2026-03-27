import NetInfo from '@react-native-community/netinfo';
import { useOfflineStore } from '../store/offlineStore';

export const setupNetworkListener = () => {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const isOnline = state.isConnected && state.isInternetReachable;
    useOfflineStore.getState().setOnlineStatus(isOnline ?? false);

    // Auto-sync when coming back online
    if (isOnline) {
      syncPendingReadings();
    }
  });

  return unsubscribe;
};

export const syncPendingReadings = async () => {
  const { pendingReadings, removePendingReading } = useOfflineStore.getState();

  for (const reading of pendingReadings.filter((r) => !r.synced)) {
    try {
      // API call would go here
      // await apiClient.post('/meter-readings', reading.data);
      await removePendingReading(reading.id);
      console.log('Synced reading:', reading.id);
    } catch (error) {
      console.error('Failed to sync reading:', reading.id, error);
    }
  }
};
