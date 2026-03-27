import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Branch, ShiftInstance } from '@shared/types';

interface AppState {
  currentBranch: Branch | null;
  currentShift: ShiftInstance | null;
  isOnline: boolean;
  setCurrentBranch: (branch: Branch | null) => void;
  setCurrentShift: (shift: ShiftInstance | null) => void;
  setIsOnline: (isOnline: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentBranch: null,
      currentShift: null,
      isOnline: true,
      setCurrentBranch: (branch) => set({ currentBranch: branch }),
      setCurrentShift: (shift) => set({ currentShift: shift }),
      setIsOnline: (isOnline) => set({ isOnline }),
    }),
    {
      name: 'app-storage',
      partialize: (state) => ({
        currentBranch: state.currentBranch,
      }),
    }
  )
);
