import { apiClient } from './client';

// ============================================================
// Types (matching backend DTOs)
// ============================================================

export interface Receipt {
  id: string;
  organizationId: string;
  customerId: string;
  branchId: string;
  receiptNumber: string;
  receiptDatetime: string;
  amount: number;
  paymentMethod: 'cash' | 'cheque' | 'bank_transfer' | 'online' | 'pso_card';
  bankId?: string;
  bankName?: string;
  referenceNumber?: string;
  notes?: string;
  attachmentPath?: string;
  allocationMode: 'FIFO' | 'MANUAL';
  allocations: ReceiptAllocation[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ReceiptAllocation {
  id: string;
  receiptId: string;
  sourceType: 'BACKDATED_TRANSACTION' | 'SALE';
  sourceId: string;
  amount: number;
  createdAt: string;
}

export type LedgerEntryType = 'INVOICE' | 'RECEIPT' | 'ADVANCE_DEPOSIT' | 'ADVANCE_HANDOUT';

export interface LedgerEntry {
  id: string;
  date: string;
  type: LedgerEntryType;
  sourceType: string;
  description: string;
  vehicleNumber?: string;
  slipNumber?: string;
  receiptNumber?: string;
  paymentMethod?: string;
  productType?: string;
  debit: number;
  credit: number;
  balance: number;
  createdBy?: string;
}

export interface LedgerResponse {
  customer: {
    id: string;
    name: string;
    phone?: string;
    creditLimit?: number;
    currentBalance: number;
    branchLimit?: number;
  };
  entries: LedgerEntry[];
  summary: {
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    closingBalance: number;
  };
  vehicleBreakdown: Array<{
    vehicleNumber: string;
    totalAmount: number;
    transactionCount: number;
  }>;
  productBreakdown: Array<{
    productType: string;
    unit: 'L' | 'units';
    totalQuantity: number;
    totalAmount: number;
    transactionCount: number;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface CustomerBalance {
  customerId: string;
  currentBalance: number;
  driftCorrected: boolean;
  driftAmount: number;
  creditLimit?: number;
  branchLimit?: number;
  utilizationPct: number;
}

export interface CreditCheckResult {
  allowed: boolean;
  warning: boolean;
  currentBalance: number;
  creditLimit?: number;
  proposedAmount: number;
  newBalance: number;
  utilizationPct: number;
  message: string;
}

export interface OpenInvoice {
  id: string;
  sourceType: 'BACKDATED_TRANSACTION' | 'SALE';
  date: string;
  vehicleNumber?: string;
  slipNumber?: string;
  description: string;
  totalAmount: number;
  allocatedAmount: number;
  openAmount: number;
}

export interface PartyPositionReport {
  customerId: string;
  customerName: string;
  balance: number;
  creditLimit?: number;
  utilizationPct: number;
  lastTransaction?: string;
}

// ============================================================
// API Client
// ============================================================

export const creditApi = {
  // ─── Receipt Operations ──────────────────────────────────

  createReceipt: async (data: {
    customerId: string;
    branchId: string;
    receiptDatetime: string;
    amount: number;
    paymentMethod: 'cash' | 'cheque' | 'bank_transfer' | 'online' | 'pso_card';
    bankId?: string;
    referenceNumber?: string;
    notes?: string;
    attachmentPath?: string;
    allocationMode: 'FIFO' | 'MANUAL';
    allocations?: Array<{
      sourceType: 'BACKDATED_TRANSACTION' | 'SALE';
      sourceId: string;
      amount: number;
    }>;
  }): Promise<Receipt> => {
    const response = await apiClient.post<{ success: boolean; data: Receipt }>('/api/credit/receipts', data);
    return response.data.data;
  },

  updateReceipt: async (
    id: string,
    data: Partial<{
      branchId: string;
      receiptDatetime: string;
      amount: number;
      paymentMethod: 'cash' | 'cheque' | 'bank_transfer' | 'online' | 'pso_card';
      bankId?: string;
      referenceNumber?: string;
      notes?: string;
      attachmentPath?: string;
      allocationMode: 'FIFO' | 'MANUAL';
      allocations?: Array<{
        sourceType: 'BACKDATED_TRANSACTION' | 'SALE';
        sourceId: string;
        amount: number;
      }>;
    }>
  ): Promise<Receipt> => {
    const response = await apiClient.put<{ success: boolean; data: Receipt }>(`/api/credit/receipts/${id}`, data);
    return response.data.data;
  },

  deleteReceipt: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/credit/receipts/${id}`);
  },

  getReceipts: async (params?: {
    customerId?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ receipts: Receipt[]; pagination: { total: number; limit: number; offset: number } }> => {
    const queryParams: Record<string, unknown> = {};
    if (params?.customerId) queryParams.customerId = params.customerId;
    if (params?.branchId) queryParams.branchId = params.branchId;
    if (params?.startDate) queryParams.startDate = params.startDate;
    if (params?.endDate) queryParams.endDate = params.endDate;
    if (params?.limit) queryParams.limit = String(params.limit);
    if (params?.offset !== undefined) queryParams.offset = String(params.offset);

    const response = await apiClient.get<{ success: boolean; data: { receipts: Receipt[]; pagination: { total: number; limit: number; offset: number } } }>('/api/credit/receipts', { params: queryParams });
    return response.data.data;
  },

  getReceiptById: async (id: string): Promise<Receipt> => {
    const response = await apiClient.get<{ success: boolean; data: Receipt }>(`/api/credit/receipts/${id}`);
    return response.data.data;
  },

  // ─── Ledger & Balance ────────────────────────────────────

  getCustomerLedger: async (
    customerId: string,
    params?: {
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
      vehicleNumber?: string;
      entryType?: LedgerEntryType;
      branchId?: string;
    }
  ): Promise<LedgerResponse> => {
    const queryParams: Record<string, unknown> = {};
    if (params?.startDate) queryParams.startDate = params.startDate;
    if (params?.endDate) queryParams.endDate = params.endDate;
    if (params?.limit) queryParams.limit = String(params.limit);
    if (params?.offset !== undefined) queryParams.offset = String(params.offset);
    if (params?.vehicleNumber) queryParams.vehicleNumber = params.vehicleNumber;
    if (params?.entryType) queryParams.entryType = params.entryType;
    if (params?.branchId) queryParams.branchId = params.branchId;

    const response = await apiClient.get<{ success: boolean; data: LedgerResponse }>(`/api/credit/customers/${customerId}/ledger`, { params: queryParams });
    return response.data.data;
  },

  getCustomerBalance: async (customerId: string): Promise<CustomerBalance> => {
    const response = await apiClient.get<{ success: boolean; data: CustomerBalance }>(`/api/credit/customers/${customerId}/balance`);
    return response.data.data;
  },

  getOpenInvoices: async (customerId: string): Promise<OpenInvoice[]> => {
    const response = await apiClient.get<{ success: boolean; data: OpenInvoice[] }>(`/api/credit/customers/${customerId}/open-invoices`);
    return response.data.data;
  },

  checkCreditLimit: async (customerId: string, branchId: string, amount: number): Promise<CreditCheckResult> => {
    const response = await apiClient.get<{ success: boolean; data: CreditCheckResult }>('/api/credit/check-limit', {
      params: {
        customerId,
        branchId,
        amount: String(amount),
      },
    });
    return response.data.data;
  },

  // ─── Reporting ──────────────────────────────────────────

  getPartyPositionReport: async (params?: {
    hideZeroBalance?: boolean;
    customerId?: string;
  }): Promise<PartyPositionReport[]> => {
    const queryParams: Record<string, unknown> = {};
    if (params?.hideZeroBalance !== undefined) queryParams.hideZeroBalance = String(params.hideZeroBalance);
    if (params?.customerId) queryParams.customerId = params.customerId;

    const response = await apiClient.get<{ success: boolean; data: PartyPositionReport[] }>('/api/credit/report/party-position', { params: queryParams });
    return response.data.data;
  },

  exportReport: async (format: 'pdf' | 'csv' | 'excel', params?: {
    customerId?: string;
    startDate?: string;
    endDate?: string;
    hideZeroBalance?: boolean;
  }): Promise<Blob> => {
    const queryParams: Record<string, unknown> = { format };
    if (params?.customerId) queryParams.customerId = params.customerId;
    if (params?.startDate) queryParams.startDate = params.startDate;
    if (params?.endDate) queryParams.endDate = params.endDate;
    if (params?.hideZeroBalance !== undefined) queryParams.hideZeroBalance = String(params.hideZeroBalance);

    const response = await apiClient.get<Blob>('/api/credit/report/export', {
      params: queryParams,
      responseType: 'blob',
    });
    return response.data;
  },

  // ─── Credit Limits ──────────────────────────────────────

  setBranchLimit: async (customerId: string, branchId: string, creditLimit: number, creditDays?: number): Promise<{ success: boolean }> => {
    const data: Record<string, unknown> = { branchId, creditLimit };
    if (creditDays !== undefined) data.creditDays = creditDays;

    const response = await apiClient.put<{ success: boolean }>(`/api/credit/customers/${customerId}/branch-limit`, data);
    return response.data;
  },

  getBranchLimits: async (customerId: string): Promise<Array<{ branchId: string; branchName: string; creditLimit: number; creditDays?: number }>> => {
    const response = await apiClient.get<{ success: boolean; data: Array<{ branchId: string; branchName: string; creditLimit: number; creditDays?: number }> }>(`/api/credit/customers/${customerId}/branch-limits`);
    return response.data.data;
  },
};
