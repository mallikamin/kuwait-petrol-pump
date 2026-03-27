import { apiClient } from './client';
import { MeterReading, PaginatedResponse } from '@/types';

export const meterReadingsApi = {
  getAll: async (params?: {
    page?: number;
    size?: number;
    shift_id?: string;
    nozzle_id?: string;
    reading_type?: 'opening' | 'closing';
  }): Promise<PaginatedResponse<MeterReading>> => {
    const response = await apiClient.get<PaginatedResponse<MeterReading>>('/api/v1/meter-readings', { params });
    return response.data;
  },

  getById: async (id: string): Promise<MeterReading> => {
    const response = await apiClient.get<MeterReading>(`/api/v1/meter-readings/${id}`);
    return response.data;
  },

  verify: async (id: string, data: { reading_value: number; is_verified: boolean }): Promise<MeterReading> => {
    const response = await apiClient.patch<MeterReading>(`/api/v1/meter-readings/${id}`, data);
    return response.data;
  },

  getVarianceReport: async (shiftId: string): Promise<any> => {
    const response = await apiClient.get(`/api/v1/meter-readings/variance-report/${shiftId}`);
    return response.data;
  },
};
