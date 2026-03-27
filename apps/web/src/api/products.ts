import { apiClient } from './client';
import { Product, Category, Stock, PaginatedResponse } from '@/types';

export const productsApi = {
  getAll: async (params?: { page?: number; size?: number; search?: string; category_id?: string }): Promise<PaginatedResponse<Product>> => {
    const response = await apiClient.get<PaginatedResponse<Product>>('/api/v1/products', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Product> => {
    const response = await apiClient.get<Product>(`/api/v1/products/${id}`);
    return response.data;
  },

  create: async (data: Partial<Product>): Promise<Product> => {
    const response = await apiClient.post<Product>('/api/v1/products', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Product>): Promise<Product> => {
    const response = await apiClient.put<Product>(`/api/v1/products/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/v1/products/${id}`);
  },

  getStock: async (productId: string, branchId?: string): Promise<Stock[]> => {
    const response = await apiClient.get<Stock[]>(`/api/v1/products/${productId}/stock`, {
      params: { branch_id: branchId },
    });
    return response.data;
  },

  updateStock: async (productId: string, branchId: string, quantity: number): Promise<Stock> => {
    const response = await apiClient.post<Stock>(`/api/v1/products/${productId}/stock`, {
      branch_id: branchId,
      quantity,
    });
    return response.data;
  },

  getCategories: async (): Promise<Category[]> => {
    const response = await apiClient.get<Category[]>('/api/v1/categories');
    return response.data;
  },

  createCategory: async (data: Partial<Category>): Promise<Category> => {
    const response = await apiClient.post<Category>('/api/v1/categories', data);
    return response.data;
  },
};
