import { apiClient } from './client';

export interface GainLossEntry {
  id: string;
  branchId: string;
  fuelTypeId: string;
  month: string;
  quantity: number;
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

  // Get entries for a branch (optionally filtered by month/fuel)
  getGainLossEntries: async (filters: {
    branchId: string;
    month?: string;
    fuelTypeId?: string;
  }) => {
    const response = await apiClient.get('/inventory/monthly-gain-loss', {
      params: filters,
    });
    return response.data as { entries: GainLossEntry[]; count: number };
  },

  // Get single entry by ID
  getGainLossEntry: async (id: string) => {
    const response = await apiClient.get(
      `/inventory/monthly-gain-loss/${id}`
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
