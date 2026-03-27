import { apiClient } from './client';
import { Sale, PaginatedResponse } from '@/types';

export interface SalesFilters {
  page?: number;
  size?: number;
  start_date?: string;
  end_date?: string;
  sale_type?: 'fuel' | 'product';
  payment_method?: 'cash' | 'card' | 'credit';
  customer_id?: string;
  status?: string;
}

export const salesApi = {
  getAll: async (params?: SalesFilters): Promise<PaginatedResponse<Sale>> => {
    const response = await apiClient.get<PaginatedResponse<Sale>>('/api/sales', { params });
    return response.data;
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
};
