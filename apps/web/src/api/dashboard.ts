import { apiClient } from './client';
import { DashboardStats, SalesChart, PaymentMethodStats, Sale, Product, Customer } from '@/types';

export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const response = await apiClient.get<DashboardStats>('/api/dashboard/stats');
    return response.data;
  },

  getSalesChart: async (date?: string): Promise<SalesChart[]> => {
    const response = await apiClient.get<SalesChart[]>('/api/dashboard/sales-chart', {
      params: { date },
    });
    return response.data;
  },

  getPaymentStats: async (): Promise<PaymentMethodStats[]> => {
    const response = await apiClient.get<PaymentMethodStats[]>('/api/dashboard/payment-stats');
    return response.data;
  },

  getRecentTransactions: async (limit: number = 10): Promise<Sale[]> => {
    const response = await apiClient.get<Sale[]>('/api/dashboard/recent-transactions', {
      params: { limit },
    });
    return response.data;
  },

  getLowStockProducts: async (): Promise<Product[]> => {
    const response = await apiClient.get<Product[]>('/api/dashboard/low-stock');
    return response.data;
  },

  getTopCustomers: async (limit: number = 5): Promise<Customer[]> => {
    const response = await apiClient.get<Customer[]>('/api/dashboard/top-customers', {
      params: { limit },
    });
    return response.data;
  },

  getLitersSold: async (): Promise<{ pmg_sold: number; hsd_sold: number }> => {
    const response = await apiClient.get<{ pmg_sold: number; hsd_sold: number }>('/api/dashboard/liters-sold');
    return response.data;
  },
};
