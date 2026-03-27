import { apiClient } from './client';

export interface ReportParams {
  start_date: string;
  end_date: string;
  branch_id?: string;
  format?: 'pdf' | 'excel';
}

export const reportsApi = {
  getDailySales: async (params: ReportParams): Promise<any> => {
    const response = await apiClient.get('/api/reports/daily-sales', { params });
    return response.data;
  },

  getShiftReport: async (shiftId: string): Promise<any> => {
    const response = await apiClient.get(`/api/reports/shift/${shiftId}`);
    return response.data;
  },

  getCustomerLedger: async (customerId: string, params: Omit<ReportParams, 'branch_id'>): Promise<any> => {
    const response = await apiClient.get(`/api/reports/customer-ledger/${customerId}`, { params });
    return response.data;
  },

  getInventoryReport: async (params: { branch_id?: string }): Promise<any> => {
    const response = await apiClient.get('/api/reports/inventory', { params });
    return response.data;
  },

  exportReport: async (reportType: string, params: ReportParams): Promise<Blob> => {
    const response = await apiClient.get(`/api/reports/${reportType}/export`, {
      params,
      responseType: 'blob',
    });
    return response.data;
  },
};
