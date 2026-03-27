import { apiClient } from './client';
import { Branch, DispensingUnit, Nozzle, PaginatedResponse } from '@/types';

export const branchesApi = {
  getAll: async (params?: { page?: number; size?: number; search?: string }): Promise<PaginatedResponse<Branch>> => {
    const response = await apiClient.get<PaginatedResponse<Branch>>('/api/branches', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Branch> => {
    const response = await apiClient.get<Branch>(`/api/branches/${id}`);
    return response.data;
  },

  create: async (data: Partial<Branch>): Promise<Branch> => {
    const response = await apiClient.post<Branch>('/api/branches', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Branch>): Promise<Branch> => {
    const response = await apiClient.put<Branch>(`/api/branches/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/branches/${id}`);
  },

  getDispensingUnits: async (branchId: string): Promise<DispensingUnit[]> => {
    const response = await apiClient.get<DispensingUnit[]>(`/api/branches/${branchId}/dispensing-units`);
    return response.data;
  },

  updateNozzleStatus: async (nozzleId: string, isActive: boolean): Promise<Nozzle> => {
    const response = await apiClient.patch<Nozzle>(`/api/nozzles/${nozzleId}`, { is_active: isActive });
    return response.data;
  },
};
