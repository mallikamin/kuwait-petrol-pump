import { apiClient } from './client';

export interface PsoTopup {
  id: string;
  organizationId: string;
  branchId: string;
  businessDate: string;
  customerId: string | null;
  psoCardLast4: string | null;
  amount: string | number;
  memo: string | null;
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
  createdByUser?: { id: string; fullName: string; username: string } | null;
  voidedByUser?: { id: string; fullName: string; username: string } | null;
}

export const psoTopupsApi = {
  list: async (params: {
    branchId: string;
    startDate?: string;
    endDate?: string;
    includeVoided?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: PsoTopup[]; total: number }> => {
    const res = await apiClient.get<{ success: boolean; items: PsoTopup[]; total: number }>(
      '/api/pso-topups',
      { params },
    );
    return { items: res.data.items, total: res.data.total };
  },

  create: async (payload: {
    branchId: string;
    businessDate: string;
    customerId?: string;
    psoCardLast4?: string;
    amount: number;
    memo?: string;
    shiftInstanceId?: string;
  }): Promise<PsoTopup> => {
    const res = await apiClient.post<{ success: boolean; data: PsoTopup }>('/api/pso-topups', payload);
    return res.data.data;
  },

  void: async (id: string, reason: string): Promise<void> => {
    await apiClient.post(`/api/pso-topups/${id}/void`, { reason });
  },
};
