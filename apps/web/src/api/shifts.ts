import { apiClient } from './client';
import { Shift, PaginatedResponse } from '@/types';

export const shiftsApi = {
  getAll: async (params?: {
    page?: number;
    size?: number;
    branch_id?: string;
    status?: 'open' | 'closed';
    start_date?: string;
    end_date?: string;
  }): Promise<PaginatedResponse<Shift>> => {
    const response = await apiClient.get<PaginatedResponse<Shift>>('/api/shifts', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Shift> => {
    const response = await apiClient.get<Shift>(`/api/shifts/${id}`);
    return response.data;
  },

  openShift: async (data: { branch_id: string; opening_cash: number }): Promise<Shift> => {
    const response = await apiClient.post<Shift>('/api/shifts/open', data);
    return response.data;
  },

  closeShift: async (shiftId: string, data: { closing_cash: number }): Promise<Shift> => {
    const response = await apiClient.post<Shift>(`/api/shifts/${shiftId}/close`, data);
    return response.data;
  },

  getActive: async (): Promise<Shift[]> => {
    const response = await apiClient.get<Shift[]>('/api/shifts/active');
    return response.data;
  },
};
