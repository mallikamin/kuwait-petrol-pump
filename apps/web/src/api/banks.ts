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
   * Get all bank accounts from QuickBooks
   */
  getAll: async (): Promise<BanksResponse> => {
    const response = await apiClient.get<BanksResponse>('/quickbooks/banks');
    return response.data;
  },
};
