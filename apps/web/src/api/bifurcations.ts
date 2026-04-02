import { apiClient } from './client';

// Types for bifurcation API responses
interface Bifurcation {
  id: string;
  branchId: string;
  date: string;
  pmgTotalLiters?: number;
  pmgTotalAmount?: number;
  hsdTotalLiters?: number;
  hsdTotalAmount?: number;
  cashAmount?: number;
  creditAmount?: number;
  cardAmount?: number;
  psoCardAmount?: number;
  expectedTotal?: number;
  actualTotal: number;
  variance?: number;
  varianceNotes?: string;
  status: 'pending' | 'completed' | 'verified';
  bifurcatedBy?: string;
  bifurcatedAt?: string;
  createdAt: string;
}

export const bifurcationsApi = {
  getAll: async (params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
    status?: 'pending' | 'completed' | 'verified';
    limit?: number;
    offset?: number;
  }): Promise<any> => {
    const response = await apiClient.get('/api/bifurcation/history', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Bifurcation> => {
    const response = await apiClient.get<Bifurcation>(`/api/bifurcation/${id}`);
    return response.data;
  },

  create: async (data: {
    branchId: string;
    date: string;
    shiftInstanceId?: string;
    pmgTotalLiters?: number;
    pmgTotalAmount?: number;
    hsdTotalLiters?: number;
    hsdTotalAmount?: number;
    cashAmount?: number;
    creditAmount?: number;
    cardAmount?: number;
    psoCardAmount?: number;
    expectedTotal?: number;
    actualTotal: number;
    varianceNotes?: string;
  }): Promise<any> => {
    const response = await apiClient.post('/api/bifurcation', data);
    return response.data;
  },

  verify: async (id: string, data: { status: 'verified' | 'rejected'; notes?: string }): Promise<Bifurcation> => {
    const response = await apiClient.patch<Bifurcation>(`/api/bifurcation/${id}/verify`, data);
    return response.data;
  },

  getSummary: async (params: {
    date: string;
    branchId: string;
  }): Promise<{
    date: string;
    branchId: string;
    pmgTotalLiters: number;
    pmgTotalAmount: number;
    hsdTotalLiters: number;
    hsdTotalAmount: number;
    cashAmount: number;
    creditAmount: number;
    cardAmount: number;
    psoCardAmount: number;
    expectedTotal: number;
    totalSalesCount: number;
  }> => {
    const response = await apiClient.get('/api/bifurcation/summary', { params });
    return response.data.summary;
  },
};
