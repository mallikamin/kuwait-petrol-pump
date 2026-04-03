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
    const response = await apiClient.get<{
      readings: MeterReading[];
      total: number;
      page: number;
      size: number;
      pages: number;
    }>('/api/meter-readings', { params });
    return {
      items: response.data.readings,
      total: response.data.total,
      page: response.data.page,
      size: response.data.size,
      pages: response.data.pages
    };
  },

  create: async (data: {
    nozzleId: string;
    shiftInstanceId: string;
    readingType: 'opening' | 'closing';
    meterValue: number;
    imageUrl?: string;
  }): Promise<MeterReading> => {
    const response = await apiClient.post<{ meterReading: MeterReading }>('/api/meter-readings', data);
    return response.data.meterReading;
  },

  getLatestForNozzle: async (nozzleId: string): Promise<MeterReading | null> => {
    try {
      const response = await apiClient.get<{ reading: MeterReading }>(`/api/meter-readings/${nozzleId}/latest`);
      return response.data.reading;
    } catch (error) {
      return null;
    }
  },

  getById: async (id: string): Promise<MeterReading> => {
    const response = await apiClient.get<MeterReading>(`/api/meter-readings/${id}`);
    return response.data;
  },

  verify: async (id: string, data: { verifiedValue: number; isManualOverride: boolean }): Promise<MeterReading> => {
    const response = await apiClient.put<{ reading: MeterReading }>(`/api/meter-readings/${id}/verify`, data);
    return response.data.reading;
  },

  getVarianceReport: async (shiftId: string): Promise<Record<string, unknown>> => {
    const response = await apiClient.get(`/api/meter-readings/variance-report/${shiftId}`);
    return response.data;
  },
};
