import { apiClient } from './client';

export interface Bank {
  id: string;
  name: string;
  accountNumber?: string | null;
  accountType: string;
  accountSubType?: string | null;
  currentBalance: number;
  active: boolean;
}

export interface BanksResponse {
  success: boolean;
  count: number;
  banks: Bank[];
}

export const banksApi = {
  /**
   * Get all banks (local POS banks)
   */
  getAll: async (): Promise<BanksResponse> => {
    const response = await apiClient.get<BanksResponse>('/banks');
    return response.data;
  },
};
