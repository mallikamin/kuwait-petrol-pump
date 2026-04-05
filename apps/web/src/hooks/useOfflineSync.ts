/**
 * useOfflineSync - Automatic offline queue management
 *
 * Non-technical user friendly:
 * - Auto-detects online/offline status
 * - Auto-queues operations when offline
 * - Auto-syncs when connection resumes
 * - No manual intervention needed
 */

import { useEffect, useState, useCallback } from 'react';
import { OfflineQueue, QueueStatus } from '@/db/indexeddb';
import { toast } from 'sonner';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Update online status
  const handleOnline = useCallback(() => {
    setIsOnline(true);
    toast.success('📶 Internet connection restored');

    // Auto-sync when coming online
    syncQueue();
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    toast.warning('📵 No internet - Work saved offline');
  }, []);

  // Sync queue to backend
  const syncQueue = useCallback(async () => {
    if (!navigator.onLine || isSyncing) return;

    try {
      setIsSyncing(true);

      const deviceId = localStorage.getItem('deviceId') || 'web-device';
      const result = await OfflineQueue.flushWhenOnline(deviceId);

      if (result.synced > 0) {
        toast.success(`✅ Synced ${result.synced} record(s)`);
      }

      if (result.failed > 0) {
        toast.error(`❌ ${result.failed} record(s) failed to sync - will retry automatically`);
      }

      // Refresh queue status
      const status = await OfflineQueue.getStatus();
      setQueueStatus(status);
    } catch (error) {
      console.error('Sync error:', error);
      // Don't show error toast - will retry automatically
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  // Refresh queue status periodically
  const refreshStatus = useCallback(async () => {
    const status = await OfflineQueue.getStatus();
    setQueueStatus(status);
  }, []);

  // Setup online/offline listeners
  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial status check
    refreshStatus();

    // Auto-sync every 30 seconds if online and pending items exist
    const syncInterval = setInterval(async () => {
      if (navigator.onLine && !isSyncing) {
        const status = await OfflineQueue.getStatus();
        if (status.pendingCount > 0) {
          syncQueue();
        }
      }
    }, 30000); // 30 seconds

    // Refresh status every 10 seconds
    const statusInterval = setInterval(refreshStatus, 10000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(syncInterval);
      clearInterval(statusInterval);
    };
  }, [handleOnline, handleOffline, syncQueue, refreshStatus, isSyncing]);

  return {
    isOnline,
    queueStatus,
    isSyncing,
    syncQueue,
    refreshStatus,
  };
}
