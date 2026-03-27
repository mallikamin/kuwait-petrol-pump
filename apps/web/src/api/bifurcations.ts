import { apiClient } from './client';
import { Bifurcation, PaginatedResponse } from '@/types';

export const bifurcationsApi = {
  getAll: async (params?: {
    page?: number;
    size?: number;
    shift_id?: string;
    status?: 'pending' | 'verified' | 'rejected';
  }): Promise<PaginatedResponse<Bifurcation>> => {
    const response = await apiClient.get<PaginatedResponse<Bifurcation>>('/api/v1/bifurcations', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Bifurcation> => {
    const response = await apiClient.get<Bifurcation>(`/api/v1/bifurcations/${id}`);
    return response.data;
  },

  create: async (data: {
    shift_id: string;
    total_sales: number;
    cash_sales: number;
    card_sales: number;
    credit_sales: number;
    physical_cash: number;
    notes?: string;
  }): Promise<Bifurcation> => {
    const response = await apiClient.post<Bifurcation>('/api/v1/bifurcations', data);
    return response.data;
  },

  verify: async (id: string, data: { status: 'verified' | 'rejected'; notes?: string }): Promise<Bifurcation> => {
    const response = await apiClient.patch<Bifurcation>(`/api/v1/bifurcations/${id}/verify`, data);
    return response.data;
  },
};
