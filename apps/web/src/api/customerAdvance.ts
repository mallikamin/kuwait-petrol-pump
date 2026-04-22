import { apiClient } from './client';

export type AdvanceDepositMethod = 'cash' | 'ibft' | 'bank_card' | 'pso_card';

export interface AdvanceMovement {
  id: string;
  organizationId: string;
  branchId: string;
  businessDate: string;
  customerId: string;
  direction: 'IN' | 'OUT';
  kind: string;
  amount: string | number;
  bankId: string | null;
  referenceNumber: string | null;
  memo: string | null;
  relatedSaleId: string | null;
  qbSynced: boolean;
  qbJournalEntryId: string | null;
  qbSyncedAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; phone: string | null } | null;
  bank?: { id: string; name: string } | null;
  createdByUser?: { id: string; fullName: string; username: string } | null;
  voidedByUser?: { id: string; fullName: string; username: string } | null;
}

export interface AdvanceBalance {
  customerId: string;
  balance: number;
  inTotal: number;
  outTotal: number;
}

export const customerAdvanceApi = {
  getBalance: async (customerId: string): Promise<AdvanceBalance> => {
    const res = await apiClient.get<{ success: boolean; data: AdvanceBalance }>(
      '/api/customer-advance/balance',
      { params: { customerId } },
    );
    return res.data.data;
  },

  listMovements: async (params: {
    customerId?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
    includeVoided?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdvanceMovement[]; total: number }> => {
    const res = await apiClient.get<{ success: boolean; items: AdvanceMovement[]; total: number }>(
      '/api/customer-advance/movements',
      { params },
    );
    return { items: res.data.items, total: res.data.total };
  },

  deposit: async (payload: {
    customerId: string;
    branchId: string;
    businessDate: string;
    method: AdvanceDepositMethod;
    amount: number;
    bankId?: string;
    referenceNumber?: string;
    memo?: string;
    shiftInstanceId?: string;
  }): Promise<AdvanceMovement> => {
    const res = await apiClient.post<{ success: boolean; data: AdvanceMovement }>(
      '/api/customer-advance/deposits',
      payload,
    );
    return res.data.data;
  },

  cashHandout: async (payload: {
    customerId: string;
    branchId: string;
    businessDate: string;
    amount: number;
    memo?: string;
    shiftInstanceId?: string;
  }): Promise<AdvanceMovement> => {
    const res = await apiClient.post<{ success: boolean; data: AdvanceMovement }>(
      '/api/customer-advance/cash-handouts',
      payload,
    );
    return res.data.data;
  },

  voidMovement: async (id: string, reason: string): Promise<void> => {
    await apiClient.post(`/api/customer-advance/movements/${id}/void`, { reason });
  },
};
