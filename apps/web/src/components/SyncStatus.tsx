/**
 * Sync Status Component (Web)
 * Sprint 1: Offline Foundation
 *
 * Displays offline queue status with pending/synced/failed counts.
 * Shows Green (synced) / Yellow (pending) / Red (error) indicator.
 */

import { useEffect, useState } from 'react';
import { OfflineQueue } from '../db/indexeddb';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { RefreshCw, WifiOff, Wifi, AlertCircle } from 'lucide-react';

interface SyncStatusProps {
  autoSync?: boolean; // Auto-sync every 30s when online
  className?: string;
}

export function SyncStatus({ autoSync = true, className }: SyncStatusProps) {
  const [status, setStatus] = useState<{
    pendingCount: number;
    failedCount: number;
    lastSyncAt?: string;
  }>({ pendingCount: 0, failedCount: 0 });
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState<string | null>(null);

  // Load status on mount and set up auto-sync
  useEffect(() => {
    loadStatus();

    // Auto-sync interval
    let intervalId: ReturnType<typeof setInterval>;
    if (autoSync && online) {
      intervalId = setInterval(() => {
        handleSync();
      }, 30000); // 30 seconds
    }

    // Online/offline event listeners
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [online, autoSync]);

  const loadStatus = async () => {
    try {
      const queueStatus = await OfflineQueue.getStatus();
      setStatus({
        pendingCount: queueStatus.pendingCount,
        failedCount: queueStatus.failedCount,
        lastSyncAt: queueStatus.lastSyncAt,
      });
    } catch (err) {
      console.error('Failed to load sync status:', err);
    }
  };

  const handleSync = async () => {
    if (!online || syncing || status.pendingCount === 0) return;

    setSyncing(true);
    setError(null);

    try {
      const deviceId = localStorage.getItem('deviceId') || 'web-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('deviceId', deviceId);

      const result = await OfflineQueue.flushWhenOnline(deviceId);

      console.log(`Sync complete: ${result.synced} synced, ${result.failed} failed, ${result.duplicates} duplicates`);

      // Reload status
      await loadStatus();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sync failed';
      setError(errorMessage);
      console.error('Sync error:', err);
    } finally {
      setSyncing(false);
    }
  };

  const getStatusColor = (): 'green' | 'yellow' | 'red' => {
    if (status.failedCount > 0) return 'red';
    if (status.pendingCount > 0) return 'yellow';
    return 'green';
  };

  const getStatusText = (): string => {
    if (!online) return 'Offline';
    if (syncing) return 'Syncing...';
    if (status.failedCount > 0) return `${status.failedCount} Failed`;
    if (status.pendingCount > 0) return `${status.pendingCount} Pending`;
    return 'Synced';
  };

  const formatLastSync = (): string | null => {
    if (!status.lastSyncAt) return null;
    const date = new Date(status.lastSyncAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Status Badge */}
      <Badge variant={getStatusColor() === 'green' ? 'default' : getStatusColor() === 'yellow' ? 'secondary' : 'destructive'}>
        {!online ? <WifiOff className="h-3 w-3 mr-1" /> : <Wifi className="h-3 w-3 mr-1" />}
        {getStatusText()}
      </Badge>

      {/* Sync Button */}
      {online && status.pendingCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="h-8"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
        </Button>
      )}

      {/* Last Sync Time */}
      {formatLastSync() && (
        <span className="text-xs text-muted-foreground">
          {formatLastSync()}
        </span>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}
