import { apiClient } from './client';

export interface ReconciliationPreviewEntry {
  id: string;
  createdAt: string;
  direction: 'IN' | 'OUT';
  source: string;
  sourceId: string | null;
  amount: number;
  memo: string | null;
  createdBy: string | null;
}

export interface ReconciliationPreview {
  branchId: string;
  businessDate: string;
  expectedCash: number;
  inflows: { total: number; bySource: Array<{ source: string; total: number; count: number }> };
  outflows: { total: number; bySource: Array<{ source: string; total: number; count: number }> };
  entries: ReconciliationPreviewEntry[];
  physicalCash: number | null;
  variance: number | null;
  status: 'open' | 'closed';
  existingId: string | null;
  notes: string | null;
  submittedBy: { id: string; fullName: string | null; username: string } | null;
  submittedAt: string | null;
  closedBy: { id: string; fullName: string | null; username: string } | null;
  closedAt: string | null;
}

export interface CashReconSummaryDay {
  businessDate: string;
  inflowsTotal: number;
  outflowsTotal: number;
  physicalCash: number | null;
  variance: number | null;
  status: 'open' | 'closed' | 'none';
  closedAt: string | null;
}

export const cashReconciliationApi = {
  getPreview: async (branchId: string, businessDate: string): Promise<ReconciliationPreview> => {
    const res = await apiClient.get<{ success: boolean; data: ReconciliationPreview }>(
      '/api/cash-reconciliation/preview',
      { params: { branchId, businessDate } },
    );
    return res.data.data;
  },

  getSummaryRange: async (
    branchId: string,
    from: string,
    to: string,
  ): Promise<CashReconSummaryDay[]> => {
    const res = await apiClient.get<{ success: boolean; data: CashReconSummaryDay[] }>(
      '/api/cash-reconciliation/summary-range',
      { params: { branchId, from, to } },
    );
    return res.data.data;
  },

  submit: async (payload: {
    branchId: string;
    businessDate: string;
    physicalCash: number;
    notes?: string;
    close?: boolean;
  }): Promise<any> => {
    const res = await apiClient.post<{ success: boolean; data: any }>(
      '/api/cash-reconciliation/submit',
      payload,
    );
    return res.data.data;
  },

  reopen: async (reconId: string, reason: string): Promise<void> => {
    await apiClient.post('/api/cash-reconciliation/reopen', { reconId, reason });
  },
};
