import { apiClient } from './client';

export interface GainLossEntry {
  id: string;
  branchId: string;
  fuelTypeId: string;
  businessDate: string | null; // YYYY-MM-DD (new flow); null for ancient legacy rows
  month: string;
  quantity: number;
  measuredQty: number | null;
  bookQtyAtDate: number | null;
  lastPurchaseRate: number | null;
  valueAtRate: number | null;
  remarks: string | null;
  recordedBy: string;
  recordedAt: string;
  fuel?: {
    code: string;
    name: string;
  };
  recordedByUser?: {
    id: string;
    username: string;
    fullName: string | null;
  };
}

export interface StockAtDateResult {
  branchId: string;
  fuelTypeId: string;
  fuelCode: string;
  asOfDate: string;
  bootstrapQty: number;
  purchasesQty: number;
  soldQty: number;
  priorGainLossQty: number;
  bookQty: number;
  lastPurchaseRate: number | null;
  lastPurchaseDate: string | null;
}

export interface MonthSummary {
  fuelCode: string;
  fuelName: string;
  totalGainLoss: number;
  entries: Array<{
    id: string;
    quantity: number;
    remarks: string | null;
    recordedAt: string;
  }>;
}

export const inventoryApi = {
  // Create a monthly gain/loss entry
  createGainLossEntry: async (data: {
    branchId: string;
    fuelTypeId: string;
    month: string;
    quantity: number;
    remarks?: string;
  }) => {
    const response = await apiClient.post('/inventory/monthly-gain-loss', data);
    return response.data as GainLossEntry;
  },

  // Get entries for a branch (optionally filtered by month/date-range/fuel)
  getGainLossEntries: async (filters: {
    branchId: string;
    month?: string;
    startDate?: string;
    endDate?: string;
    fuelTypeId?: string;
  }) => {
    const response = await apiClient.get('/inventory/monthly-gain-loss', {
      params: filters,
    });
    return response.data as { entries: GainLossEntry[]; count: number };
  },

  // Date-keyed creation (new Gain/Loss page).
  // Either measuredQty (system computes gain/loss) OR quantity (manual override)
  // must be supplied. Server snapshots lastPurchaseRate + bookQtyAtDate.
  createGainLossByDate: async (data: {
    branchId: string;
    fuelTypeId: string;
    businessDate: string; // YYYY-MM-DD
    measuredQty?: number;
    quantity?: number;
    remarks?: string;
  }) => {
    const response = await apiClient.post('/inventory/monthly-gain-loss/by-date', data);
    return response.data as GainLossEntry;
  },

  // Live stock-at-date lookup for the form's "current PMG/HSD level" field.
  getStockAtDate: async (params: {
    branchId: string;
    fuelTypeId: string;
    asOfDate: string;
  }) => {
    const response = await apiClient.get('/inventory/monthly-gain-loss/stock-at-date', {
      params,
    });
    return response.data as StockAtDateResult;
  },

  // Get single entry by ID
  getGainLossEntry: async (id: string) => {
    const response = await apiClient.get(
      `/inventory/monthly-gain-loss/${id}`
    );
    return response.data as GainLossEntry;
  },

  // Edit an existing entry. measuredQty edits re-derive quantity against
  // the originally captured bookQtyAtDate (server-side).
  updateGainLossEntry: async (
    id: string,
    data: { measuredQty?: number | null; quantity?: number; remarks?: string | null },
  ) => {
    const response = await apiClient.patch(
      `/inventory/monthly-gain-loss/${id}`,
      data,
    );
    return response.data as GainLossEntry;
  },

  // Delete an entry
  deleteGainLossEntry: async (id: string) => {
    const response = await apiClient.delete(
      `/inventory/monthly-gain-loss/${id}`
    );
    return response.data;
  },

  // Get month summary
  getMonthSummary: async (branchId: string, month: string) => {
    const response = await apiClient.get('/inventory/monthly-gain-loss/summary', {
      params: { branchId, month },
    });
    return response.data as {
      month: string;
      branchId: string;
      summary: MonthSummary[];
      totalFuelTypes: number;
    };
  },
};
