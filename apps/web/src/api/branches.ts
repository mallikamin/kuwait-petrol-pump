import { apiClient } from './client';
import { Branch, DispensingUnit, Nozzle, PaginatedResponse } from '@/types';

export const branchesApi = {
  getAll: async (params?: { page?: number; size?: number; search?: string }): Promise<PaginatedResponse<Branch>> => {
    const response = await apiClient.get<{ branches: Branch[] }>('/api/branches', { params });
    return { items: response.data.branches, total: response.data.branches.length, page: 1, size: 50, pages: 1 };
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

  createDispensingUnit: async (branchId: string, data: { name: string; unitNumber: number }): Promise<DispensingUnit> => {
    const response = await apiClient.post<DispensingUnit>(`/api/branches/${branchId}/dispensing-units`, {
      name: data.name,
      unit_number: data.unitNumber,
    });
    return response.data;
  },

  createNozzle: async (unitId: string, data: { nozzleNumber: number; fuelTypeId: string; meterType?: string }): Promise<Nozzle> => {
    const response = await apiClient.post<Nozzle>(`/api/dispensing-units/${unitId}/nozzles`, {
      nozzle_number: data.nozzleNumber,
      fuel_type_id: data.fuelTypeId,
      meter_type: data.meterType || 'digital',
    });
    return response.data;
  },

  updateNozzle: async (nozzleId: string, data: Partial<{ nozzleNumber: number; fuelTypeId: string; meterType: string; isActive: boolean }>): Promise<Nozzle> => {
    const payload: any = {};
    if (data.nozzleNumber !== undefined) payload.nozzle_number = data.nozzleNumber;
    if (data.fuelTypeId !== undefined) payload.fuel_type_id = data.fuelTypeId;
    if (data.meterType !== undefined) payload.meter_type = data.meterType;
    if (data.isActive !== undefined) payload.is_active = data.isActive;

    const response = await apiClient.patch<Nozzle>(`/api/nozzles/${nozzleId}`, payload);
    return response.data;
  },

  updateNozzleStatus: async (nozzleId: string, isActive: boolean): Promise<Nozzle> => {
    const response = await apiClient.patch<Nozzle>(`/api/nozzles/${nozzleId}`, { is_active: isActive });
    return response.data;
  },
};
