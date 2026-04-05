import { apiClient } from './client';

export interface Supplier {
  id: string;
  organizationId: string;
  name: string;
  code?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  paymentTerms?: string;
  creditDays?: number;
  qbVendorId?: string;
  qbSynced: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierBalance {
  supplierId: string;
  supplierName: string;
  totalPurchases: number;
  totalPaid: number;
  balance: number;
}

export const suppliersApi = {
  getAll: async (params?: { search?: string; isActive?: string; limit?: number; offset?: number }) => {
    const response = await apiClient.get<{ suppliers: Supplier[]; pagination: { total: number; limit: number; offset: number; pages: number } }>('/api/suppliers', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Supplier> => {
    const response = await apiClient.get<Supplier>(`/api/suppliers/${id}`);
    return response.data;
  },

  create: async (data: Partial<Supplier>): Promise<Supplier> => {
    const response = await apiClient.post<Supplier>('/api/suppliers', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Supplier>): Promise<Supplier> => {
    const response = await apiClient.put<Supplier>(`/api/suppliers/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/suppliers/${id}`);
  },

  getBalance: async (id: string): Promise<SupplierBalance> => {
    const response = await apiClient.get<SupplierBalance>(`/api/suppliers/${id}/balance`);
    return response.data;
  },
};
