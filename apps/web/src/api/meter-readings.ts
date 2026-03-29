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
    const response = await apiClient.get<{ readings: MeterReading[] }>('/api/meter-readings', { params });
    return { items: response.data.readings, total: response.data.readings.length, page: params?.page || 1, size: params?.size || 50, pages: 1 };
  },

  getById: async (id: string): Promise<MeterReading> => {
    const response = await apiClient.get<MeterReading>(`/api/meter-readings/${id}`);
    return response.data;
  },

  verify: async (id: string, data: { reading_value: number; is_verified: boolean }): Promise<MeterReading> => {
    const response = await apiClient.patch<MeterReading>(`/api/meter-readings/${id}`, data);
    return response.data;
  },

  getVarianceReport: async (shiftId: string): Promise<Record<string, unknown>> => {
    const response = await apiClient.get(`/api/meter-readings/variance-report/${shiftId}`);
    return response.data;
  },
};
