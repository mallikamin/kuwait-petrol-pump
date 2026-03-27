import { apiClient } from './client';
import { DashboardStats, SalesChart, PaymentMethodStats, Sale, Product, Customer } from '@/types';

export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const response = await apiClient.get<DashboardStats>('/api/v1/dashboard/stats');
    return response.data;
  },

  getSalesChart: async (date?: string): Promise<SalesChart[]> => {
    const response = await apiClient.get<SalesChart[]>('/api/v1/dashboard/sales-chart', {
      params: { date },
    });
    return response.data;
  },

  getPaymentStats: async (): Promise<PaymentMethodStats[]> => {
    const response = await apiClient.get<PaymentMethodStats[]>('/api/v1/dashboard/payment-stats');
    return response.data;
  },

  getRecentTransactions: async (limit: number = 10): Promise<Sale[]> => {
    const response = await apiClient.get<Sale[]>('/api/v1/dashboard/recent-transactions', {
      params: { limit },
    });
    return response.data;
  },

  getLowStockProducts: async (): Promise<Product[]> => {
    const response = await apiClient.get<Product[]>('/api/v1/dashboard/low-stock');
    return response.data;
  },

  getTopCustomers: async (limit: number = 5): Promise<Customer[]> => {
    const response = await apiClient.get<Customer[]>('/api/v1/dashboard/top-customers', {
      params: { limit },
    });
    return response.data;
  },
};
