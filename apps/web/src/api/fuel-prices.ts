import { apiClient } from './client';
import { FuelType, FuelPrice, PaginatedResponse } from '@/types';

export const fuelPricesApi = {
  getFuelTypes: async (): Promise<FuelType[]> => {
    const response = await apiClient.get<FuelType[]>('/api/fuel-prices/fuel-types');
    return response.data;
  },

  getCurrentPrices: async (): Promise<any[]> => {
    const response = await apiClient.get<any[]>('/api/fuel-prices/current');
    return response.data;
  },

  getPriceHistory: async (fuelTypeId?: string, params?: { page?: number; size?: number }): Promise<PaginatedResponse<FuelPrice>> => {
    const response = await apiClient.get<FuelPrice[]>('/api/fuel-prices/history', {
      params: { ...params, fuelTypeId },
    });
    return { items: response.data, total: response.data.length, page: params?.page || 1, size: params?.size || 50, pages: 1 };
  },

  updatePrice: async (data: { fuelTypeId: string; price: number; effectiveFrom: string }): Promise<FuelPrice> => {
    const response = await apiClient.post<FuelPrice>('/api/fuel-prices', data);
    return response.data;
  },
};
