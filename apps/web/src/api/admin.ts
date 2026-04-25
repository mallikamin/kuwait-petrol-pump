import { apiClient } from './client';

export interface AdminQbConnection {
  id: string;
  companyName: string;
  realmId: string;
  syncMode: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

export interface AdminBranchSummary {
  id: string;
  code: string | null;
  name: string;
  location: string | null;
  isActive: boolean;
  createdAt: string;
  userCount: number;
}

export interface AdminClientSummary {
  id: string;
  code: string | null;
  name: string;
  companyName: string | null;
  companyAddress: string | null;
  currency: string;
  timezone: string;
  isDemo: boolean;
  tenancyMode: string;
  createdAt: string;
  userCount: number;
  branches: AdminBranchSummary[];
  qbConnection: AdminQbConnection | null;
}

export interface ListClientsResponse {
  clients: AdminClientSummary[];
}

export const adminApi = {
  listClients: async (): Promise<ListClientsResponse> => {
    const response = await apiClient.get<ListClientsResponse>('/api/admin/clients');
    return response.data;
  },
};
