import React, { useEffect, useState } from 'react';
import { OfflineQueue } from '../db/indexeddb';

export const SyncStatusBadge: React.FC = () => {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadStatus();

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Auto-sync every 30s when online
    const interval = setInterval(() => {
      if (navigator.onLine) handleSync();
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  // Flush when coming back online
  useEffect(() => {
    if (online && pending > 0) {
      handleSync();
    }
  }, [online]);

  const loadStatus = async () => {
    try {
      const status = await OfflineQueue.getStatus();
      setPending(status.pendingCount);
      setFailed(status.failedCount);
    } catch {
      // IndexedDB not ready yet
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const deviceId = localStorage.getItem('deviceId') || 'desktop-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('deviceId', deviceId);
      await OfflineQueue.flushWhenOnline(deviceId);
    } catch {
      // Will retry next interval
    } finally {
      setSyncing(false);
      await loadStatus();
    }
  };

  const color = failed > 0 ? '#ef4444' : pending > 0 ? '#eab308' : '#22c55e';
  const text = !online
    ? 'Offline'
    : syncing
    ? 'Syncing...'
    : failed > 0
    ? `${failed} Failed`
    : pending > 0
    ? `${pending} Pending`
    : 'Synced';

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {text}
      </span>
      {online && pending > 0 && !syncing && (
        <button
          onClick={handleSync}
          className="text-xs text-blue-600 hover:text-blue-800 underline"
        >
          Sync Now
        </button>
      )}
    </div>
  );
};
