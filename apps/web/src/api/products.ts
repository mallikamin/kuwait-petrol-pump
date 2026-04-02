import { apiClient } from './client';
import { Product, Category, Stock, PaginatedResponse } from '@/types';

export const productsApi = {
  getAll: async (params?: { page?: number; size?: number; search?: string; category_id?: string }): Promise<PaginatedResponse<Product>> => {
    // Backend expects limit/offset, not page/size
    const backendParams: Record<string, unknown> = {};
    if (params?.search) backendParams.search = params.search;
    if (params?.category_id) backendParams.category = params.category_id;
    if (params?.size) backendParams.limit = String(params.size);
    if (params?.page && params?.size) backendParams.offset = String((params.page - 1) * params.size);
    const response = await apiClient.get<{ products: Product[]; pagination: { total: number; limit: number; offset: number; pages: number } }>('/api/products', { params: backendParams });
    return { items: response.data.products, total: response.data.pagination.total, page: params?.page || 1, size: response.data.pagination.limit, pages: response.data.pagination.pages };
  },

  getById: async (id: string): Promise<Product> => {
    const response = await apiClient.get<Product>(`/api/products/${id}`);
    return response.data;
  },

  create: async (data: Partial<Product>): Promise<Product> => {
    const response = await apiClient.post<Product>('/api/products', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Product>): Promise<Product> => {
    const response = await apiClient.put<Product>(`/api/products/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/products/${id}`);
  },

  getStock: async (productId: string, branchId?: string): Promise<Stock[]> => {
    const response = await apiClient.get<Stock[]>(`/api/products/${productId}/stock`, {
      params: { branch_id: branchId },
    });
    return response.data;
  },

  updateStock: async (productId: string, branchId: string, quantity: number): Promise<Stock> => {
    const response = await apiClient.put<Stock>(`/api/products/${productId}/stock`, {
      branch_id: branchId,
      quantity,
    });
    return response.data;
  },

  getCategories: async (): Promise<Category[]> => {
    const response = await apiClient.get<Category[]>('/api/products/categories');
    return response.data;
  },

  createCategory: async (data: Partial<Category>): Promise<Category> => {
    const response = await apiClient.post<Category>('/api/products/categories', data);
    return response.data;
  },
};
