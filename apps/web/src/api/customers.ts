import { apiClient } from './client';
import { Customer, LedgerEntry, PaginatedResponse } from '@/types';

export const customersApi = {
  getAll: async (params?: { page?: number; size?: number; search?: string }): Promise<PaginatedResponse<Customer>> => {
    // Backend expects limit/offset, not page/size
    const backendParams: Record<string, unknown> = {};
    if (params?.search) backendParams.search = params.search;
    if (params?.size) backendParams.limit = String(params.size);
    if (params?.page && params?.size) backendParams.offset = String((params.page - 1) * params.size);
    const response = await apiClient.get<{ customers: Customer[]; pagination: { total: number; limit: number; offset: number; pages: number } }>('/api/customers', { params: backendParams });
    return { items: response.data.customers, total: response.data.pagination.total, page: params?.page || 1, size: response.data.pagination.limit, pages: response.data.pagination.pages };
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
