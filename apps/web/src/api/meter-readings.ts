import { apiClient } from './client';
import { MeterReading, PaginatedResponse } from '@/types';

export const meterReadingsApi = {
  getAll: async (params?: {
    page?: number;
    size?: number;
    shift_id?: string;
    nozzle_id?: string;
    date?: string;
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

  // ✅ Backdated meter readings (shift-independent, day-level)
  getDailyBackdatedReadings: async (params: {
    branchId: string;
    businessDate: string; // YYYY-MM-DD
  }): Promise<{
    businessDate: string;
    branchId: string;
    nozzles: Array<{
      nozzleId: string;
      nozzleName: string;
      fuelType: string;
      fuelTypeName: string;
      opening: {
        id?: string; // Database ID for edit/delete
        value: number | null;
        status: 'entered' | 'missing';
        recordedBy?: string;
        recordedAt?: string;
        submittedBy?: string;
        submittedByName?: string;
        submittedAt?: string;
        imageUrl?: string;
        attachmentUrl?: string;
        ocrManuallyEdited?: boolean;
      };
      closing: {
        id?: string; // Database ID for edit/delete
        value: number | null;
        status: 'entered' | 'missing';
        recordedBy?: string;
        recordedAt?: string;
        submittedBy?: string;
        submittedByName?: string;
        submittedAt?: string;
        imageUrl?: string;
        attachmentUrl?: string;
        ocrManuallyEdited?: boolean;
      };
    }>;
    summary: {
      totalNozzles: number;
      totalReadingsExpected: number;
      totalReadingsEntered: number;
      totalReadingsMissing: number;
      completionPercent: number;
    };
  }> => {
    const response = await apiClient.get('/api/backdated-meter-readings/daily', {
      params: {
        branchId: params.branchId,
        businessDate: params.businessDate,
      },
    });
    return response.data?.data ?? response.data;
  },

  getModalPreviousReading: async (params: {
    branchId: string;
    businessDate: string;
    shiftId: string;
    nozzleId: string;
    readingType: 'opening' | 'closing';
  }): Promise<{ value: number | null; status: 'entered' | 'propagated' | 'not_found' } | null> => {
    try {
      const response = await apiClient.get('/api/backdated-meter-readings/daily/modal/previous-reading', {
        params,
      });
      return response.data?.data ?? null;
    } catch (error) {
      return null;
    }
  },
};
