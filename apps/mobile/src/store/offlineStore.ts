import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineReading } from '../types';

interface OfflineState {
  isOnline: boolean;
  pendingReadings: OfflineReading[];

  setOnlineStatus: (status: boolean) => void;
  addPendingReading: (reading: OfflineReading) => Promise<void>;
  removePendingReading: (id: string) => Promise<void>;
  loadPendingReadings: () => Promise<void>;
  markReadingAsSynced: (id: string) => Promise<void>;
}

const STORAGE_KEY = 'offline_readings';

export const useOfflineStore = create<OfflineState>((set, get) => ({
  isOnline: true,
  pendingReadings: [],

  setOnlineStatus: (status) => {
    set({ isOnline: status });
  },

  addPendingReading: async (reading) => {
    const { pendingReadings } = get();
    const updated = [...pendingReadings, reading];
    set({ pendingReadings: updated });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  removePendingReading: async (id) => {
    const { pendingReadings } = get();
    const updated = pendingReadings.filter((r) => r.id !== id);
    set({ pendingReadings: updated });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  loadPendingReadings: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        set({ pendingReadings: JSON.parse(stored) });
      }
    } catch (error) {
      console.error('Error loading pending readings:', error);
    }
  },

  markReadingAsSynced: async (id) => {
    const { pendingReadings } = get();
    const updated = pendingReadings.map((r) =>
      r.id === id ? { ...r, synced: true } : r
    );
    set({ pendingReadings: updated });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },
}));
