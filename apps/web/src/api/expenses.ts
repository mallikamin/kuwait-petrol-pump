import { apiClient } from './client';

export interface ExpenseAccount {
  id: string;
  organizationId: string;
  label: string;
  qbAccountName: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseEntry {
  id: string;
  organizationId: string;
  branchId: string;
  businessDate: string;
  shiftInstanceId: string | null;
  expenseAccountId: string;
  amount: string | number;
  memo: string | null;
  attachmentPath: string | null;
  qbSynced: boolean;
  qbPurchaseId: string | null;
  qbSyncedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  expenseAccount?: { id: string; label: string; qbAccountName: string | null };
  createdByUser?: { id: string; fullName: string; username: string } | null;
  voidedByUser?: { id: string; fullName: string; username: string } | null;
}

export const expensesApi = {
  listAccounts: async (includeInactive = false): Promise<ExpenseAccount[]> => {
    const res = await apiClient.get<{ success: boolean; items: ExpenseAccount[] }>(
      '/api/expenses/accounts',
      { params: { includeInactive } },
    );
    return res.data.items;
  },

  createAccount: async (payload: {
    label: string;
    qbAccountName?: string;
    sortOrder?: number;
  }): Promise<ExpenseAccount> => {
    const res = await apiClient.post<{ success: boolean; data: ExpenseAccount }>(
      '/api/expenses/accounts',
      payload,
    );
    return res.data.data;
  },

  updateAccount: async (
    id: string,
    patch: { label?: string; qbAccountName?: string | null; sortOrder?: number; isActive?: boolean },
  ): Promise<ExpenseAccount> => {
    const res = await apiClient.patch<{ success: boolean; data: ExpenseAccount }>(
      `/api/expenses/accounts/${id}`,
      patch,
    );
    return res.data.data;
  },

  listEntries: async (params: {
    branchId: string;
    startDate?: string;
    endDate?: string;
    expenseAccountId?: string;
    includeVoided?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ExpenseEntry[]; total: number }> => {
    const res = await apiClient.get<{ success: boolean; items: ExpenseEntry[]; total: number }>(
      '/api/expenses/entries',
      { params },
    );
    return { items: res.data.items, total: res.data.total };
  },

  createEntry: async (payload: {
    branchId: string;
    businessDate: string;
    expenseAccountId: string;
    amount: number;
    memo?: string;
    attachmentPath?: string;
    shiftInstanceId?: string;
  }): Promise<ExpenseEntry> => {
    const res = await apiClient.post<{ success: boolean; data: ExpenseEntry }>(
      '/api/expenses/entries',
      payload,
    );
    return res.data.data;
  },

  voidEntry: async (id: string, reason: string): Promise<void> => {
    await apiClient.post(`/api/expenses/entries/${id}/void`, { reason });
  },
};
