import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setUser: (user: User) => void;
  setToken: (token: string) => void;
  logout: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => {
    set({ user, isAuthenticated: true });
    AsyncStorage.setItem('user', JSON.stringify(user));
  },

  setToken: (token) => {
    set({ token, isAuthenticated: true });
    AsyncStorage.setItem('access_token', token);
  },

  logout: async () => {
    await AsyncStorage.multiRemove(['access_token', 'user']);
    set({ user: null, token: null, isAuthenticated: false });
  },

  loadStoredAuth: async () => {
    try {
      const [token, userStr] = await AsyncStorage.multiGet([
        'access_token',
        'user',
      ]);

      const storedToken = token[1];
      const storedUser = userStr[1] ? JSON.parse(userStr[1]) : null;

      if (storedToken && storedUser) {
        set({
          token: storedToken,
          user: storedUser,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Error loading stored auth:', error);
      set({ isLoading: false });
    }
  },
}));
