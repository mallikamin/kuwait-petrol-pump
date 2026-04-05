import { apiClient } from './client';
import { Shift, ShiftTemplate, PaginatedResponse } from '@/types';

export const shiftsApi = {
  create: async (data: {
    branchId: string;
    shiftNumber: number;
    name?: string;
    startTime: string; // HH:MM format
    endTime: string; // HH:MM format
  }): Promise<Shift> => {
    const response = await apiClient.post<{ shift: Shift }>('/api/shifts', data);
    return response.data.shift;
  },

  getAll: async (params?: {
    page?: number;
    size?: number;
    branch_id?: string;
    status?: 'open' | 'closed';
    start_date?: string;
    end_date?: string;
  }): Promise<PaginatedResponse<ShiftTemplate>> => {
    const response = await apiClient.get<PaginatedResponse<ShiftTemplate>>('/api/shifts', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Shift> => {
    const response = await apiClient.get<Shift>(`/api/shifts/${id}`);
    return response.data;
  },

  openShift: async (data: { branch_id: string; shift_id: string }): Promise<Shift> => {
    const response = await apiClient.post<{ shiftInstance: Shift }>('/api/shifts/open', {
      branchId: data.branch_id,
      shiftId: data.shift_id,
    });
    return response.data.shiftInstance;
  },

  closeShift: async (shiftId: string, data: { closing_cash: number }): Promise<Shift> => {
    const response = await apiClient.post<Shift>(`/api/shifts/${shiftId}/close`, data);
    return response.data;
  },

  getCurrent: async (branchId: string): Promise<Shift | null> => {
    try {
      const response = await apiClient.get<{ currentShift: Shift | null }>('/api/shifts/current', {
        params: { branchId },
      });
      return response.data.currentShift;
    } catch (error) {
      return null;
    }
  },

  getHistory: async (params: {
    branchId: string;
    startDate?: string;
    endDate?: string;
    status?: 'pending' | 'open' | 'closed';
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Shift>> => {
    const response = await apiClient.get<PaginatedResponse<Shift>>('/api/shifts/history', { params });
    return response.data;
  },
};
