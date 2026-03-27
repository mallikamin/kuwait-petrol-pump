import { apiClient } from './client';
import { Customer, LedgerEntry, PaginatedResponse } from '@/types';

export const customersApi = {
  getAll: async (params?: { page?: number; size?: number; search?: string }): Promise<PaginatedResponse<Customer>> => {
    const response = await apiClient.get<PaginatedResponse<Customer>>('/api/customers', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Customer> => {
    const response = await apiClient.get<Customer>(`/api/customers/${id}`);
    return response.data;
  },

  create: async (data: Partial<Customer>): Promise<Customer> => {
    const response = await apiClient.post<Customer>('/api/customers', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Customer>): Promise<Customer> => {
    const response = await apiClient.put<Customer>(`/api/customers/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/customers/${id}`);
  },

  getLedger: async (customerId: string, params?: { page?: number; size?: number }): Promise<PaginatedResponse<LedgerEntry>> => {
    const response = await apiClient.get<PaginatedResponse<LedgerEntry>>(`/api/customers/${customerId}/ledger`, { params });
    return response.data;
  },
};
