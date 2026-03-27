import { apiClient } from './client';
import { FuelType, FuelPrice, PaginatedResponse } from '@/types';

export const fuelPricesApi = {
  getFuelTypes: async (): Promise<FuelType[]> => {
    const response = await apiClient.get<FuelType[]>('/api/v1/fuel-types');
    return response.data;
  },

  getPriceHistory: async (fuelTypeId?: string, params?: { page?: number; size?: number }): Promise<PaginatedResponse<FuelPrice>> => {
    const response = await apiClient.get<PaginatedResponse<FuelPrice>>('/api/v1/fuel-prices', {
      params: { ...params, fuel_type_id: fuelTypeId },
    });
    return response.data;
  },

  updatePrice: async (data: { fuel_type_id: string; price: number; effective_from: string }): Promise<FuelPrice> => {
    const response = await apiClient.post<FuelPrice>('/api/v1/fuel-prices', data);
    return response.data;
  },
};
