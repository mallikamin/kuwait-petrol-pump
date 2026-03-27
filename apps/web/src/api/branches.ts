import { apiClient } from './client';
import { Branch, DispensingUnit, Nozzle, PaginatedResponse } from '@/types';

export const branchesApi = {
  getAll: async (params?: { page?: number; size?: number; search?: string }): Promise<PaginatedResponse<Branch>> => {
    const response = await apiClient.get<PaginatedResponse<Branch>>('/api/v1/branches', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Branch> => {
    const response = await apiClient.get<Branch>(`/api/v1/branches/${id}`);
    return response.data;
  },

  create: async (data: Partial<Branch>): Promise<Branch> => {
    const response = await apiClient.post<Branch>('/api/v1/branches', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Branch>): Promise<Branch> => {
    const response = await apiClient.put<Branch>(`/api/v1/branches/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/v1/branches/${id}`);
  },

  getDispensingUnits: async (branchId: string): Promise<DispensingUnit[]> => {
    const response = await apiClient.get<DispensingUnit[]>(`/api/v1/branches/${branchId}/dispensing-units`);
    return response.data;
  },

  updateNozzleStatus: async (nozzleId: string, isActive: boolean): Promise<Nozzle> => {
    const response = await apiClient.patch<Nozzle>(`/api/v1/nozzles/${nozzleId}`, { is_active: isActive });
    return response.data;
  },
};
