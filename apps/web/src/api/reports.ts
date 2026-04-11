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
    return response.data.report || response.data;
  },

  getInventoryReport: async (branchId: string, asOfDate?: string, startDate?: string, endDate?: string): Promise<any> => {
    const params: any = { branchId };
    // Date filter precedence:
    // 1. If startDate/endDate provided => range mode
    // 2. Else if asOfDate provided => single-date mode
    // 3. Else => no filter (all purchases)
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (asOfDate) {
      params.asOfDate = asOfDate;
    }
    const response = await apiClient.get('/api/reports/inventory', { params });
    return response.data.report || response.data;
  },

  getFuelPriceHistory: async (startDate: string, endDate: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/fuel-price-history', {
      params: { startDate, endDate },
    });
    return response.data.report || response.data;
  },

  getCustomerWiseSales: async (branchId: string, startDate: string, endDate: string, customerId?: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/customer-wise-sales', {
      params: { branchId, startDate, endDate, customerId },
    });
    return response.data.report || response.data;
  },
};
