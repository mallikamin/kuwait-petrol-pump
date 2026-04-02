import { apiClient } from './client';
import { Sale, PaginatedResponse } from '@/types';

export interface SalesFilters {
  page?: number;
  size?: number;
  startDate?: string;
  endDate?: string;
  saleType?: 'fuel' | 'product' | 'non_fuel' | string;
  paymentMethod?: 'cash' | 'card' | 'credit' | string;
  customerId?: string;
  status?: string;
}

export const salesApi = {
  getAll: async (params?: SalesFilters): Promise<PaginatedResponse<Sale>> => {
    const response = await apiClient.get<any>('/api/sales', { params });
    const data = response.data;
    // Backend returns { sales: [...], pagination: { total, limit, offset, pages } }
    const sales = data.sales || data.items || [];
    const pagination = data.pagination || {};
    return {
      items: sales,
      total: pagination.total || sales.length,
      page: params?.page || 1,
      size: params?.size || pagination.limit || 50,
      pages: pagination.pages || 1,
    };
  },

  getById: async (id: string): Promise<Sale> => {
    const response = await apiClient.get<Sale>(`/api/sales/${id}`);
    return response.data;
  },

  exportToCSV: async (params?: SalesFilters): Promise<Blob> => {
    const response = await apiClient.get('/api/sales/export', {
      params,
      responseType: 'blob',
    });
    return response.data;
  },

  getTodaysSales: async (): Promise<{ sales: any[]; count: number }> => {
    const response = await apiClient.get<{ sales: any[]; count: number }>('/api/sales/today');
    return response.data;
  },
};
