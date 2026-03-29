/**
 * Sync Status Badge Component (Mobile)
 * Sprint 1: Offline Foundation
 *
 * Displays offline queue status for mobile app.
 * Shows Green (synced) / Yellow (pending) / Red (error) indicator.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { OfflineQueue } from '../services/offline-queue';

interface SyncStatusBadgeProps {
  autoSync?: boolean; // Auto-sync every 30s when online
}

export function SyncStatusBadge({ autoSync = true }: SyncStatusBadgeProps) {
  const [status, setStatus] = useState<{
    pendingCount: number;
    failedCount: number;
    lastSyncAt?: string;
  }>({ pendingCount: 0, failedCount: 0 });
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load status on mount and set up auto-sync
  useEffect(() => {
    loadStatus();

    // Subscribe to network status
    const unsubscribe = NetInfo.addEventListener(state => {
      setOnline(state.isConnected || false);
    });

    // Auto-sync interval
    let intervalId: NodeJS.Timeout;
    if (autoSync && online) {
      intervalId = setInterval(() => {
        handleSync();
      }, 30000); // 30 seconds
    }

    return () => {
      unsubscribe();
      if (intervalId) clearInterval(intervalId);
    };
  }, [online, autoSync]);

  const loadStatus = async () => {
    try {
      const queueStatus = await OfflineQueue.getStatus();
      setStatus({
        pendingCount: queueStatus.pendingSales + queueStatus.pendingMeterReadings,
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
      const deviceId = 'mobile-' + Math.random().toString(36).substr(2, 9);
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

  const getStatusColor = (): string => {
    if (status.failedCount > 0) return '#ef4444'; // red
    if (status.pendingCount > 0) return '#eab308'; // yellow
    return '#22c55e'; // green
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
    <View style={styles.container}>
      {/* Status Badge */}
      <View style={[styles.badge, { backgroundColor: getStatusColor() }]}>
        <Text style={styles.badgeText}>{getStatusText()}</Text>
      </View>

      {/* Sync Button */}
      {online && status.pendingCount > 0 && (
        <TouchableOpacity
          style={styles.syncButton}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.syncButtonText}>↻</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Last Sync Time */}
      {formatLastSync() && (
        <Text style={styles.lastSync}>{formatLastSync()}</Text>
      )}

      {/* Error Message */}
      {error && (
        <Text style={styles.error}>⚠️ {error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  syncButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  lastSync: {
    fontSize: 11,
    color: '#6b7280',
  },
  error: {
    fontSize: 11,
    color: '#ef4444',
  },
});
