import { apiClient } from './client';

export const reportsApi = {
  getDailySales: async (branchId: string, date: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/daily-sales', {
      params: { branchId, date },
    });
    return response.data.report || response.data;
  },

  getShiftReport: async (shiftInstanceId: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/shift', {
      params: { shiftInstanceId },
    });
    return response.data.report || response.data;
  },

  getVarianceReport: async (branchId: string, startDate: string, endDate: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/variance', {
      params: { branchId, startDate, endDate },
    });
    return response.data.report || response.data;
  },

  getCustomerLedger: async (customerId: string, startDate: string, endDate: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/customer-ledger', {
      params: { customerId, startDate, endDate },
    });
    // TEMP LOGGING
    console.log('[LEDGER DEBUG] API response received:', {
      hasReport: !!response.data.report,
      totalTransactions: response.data.report?.summary?.totalTransactions,
      transactionsLength: response.data.report?.transactions?.length,
    });
    return response.data.report || response.data;
  },

  getInventoryReport: async (branchId: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/inventory', {
      params: { branchId },
    });
    return response.data.report || response.data;
  },

  getFuelPriceHistory: async (startDate: string, endDate: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/fuel-price-history', {
      params: { startDate, endDate },
    });
    return response.data.report || response.data;
  },
};
