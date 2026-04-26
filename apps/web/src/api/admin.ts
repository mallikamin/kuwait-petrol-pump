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

export interface AdminUserOrgRef {
  id: string;
  code: string | null;
  name: string;
  grantedAt?: string;
}

export interface AdminUserWithOrgAccess {
  id: string;
  username: string;
  fullName: string | null;
  role: string;
  primaryOrg: { id: string; code: string | null; name: string } | null;
  grantedOrgs: AdminUserOrgRef[];
}

export interface ListUsersWithOrgAccessResponse {
  users: AdminUserWithOrgAccess[];
}

export interface UserOrgAccessResponse {
  userId: string;
  orgs: AdminUserOrgRef[];
}

export const adminApi = {
  listClients: async (): Promise<ListClientsResponse> => {
    const response = await apiClient.get<ListClientsResponse>('/api/admin/clients');
    return response.data;
  },

  listUsersWithOrgAccess: async (): Promise<ListUsersWithOrgAccessResponse> => {
    const response = await apiClient.get<ListUsersWithOrgAccessResponse>(
      '/api/admin/users-with-org-access'
    );
    return response.data;
  },

  setUserOrgAccess: async (userId: string, orgIds: string[]): Promise<UserOrgAccessResponse> => {
    const response = await apiClient.put<UserOrgAccessResponse>(
      `/api/admin/users/${userId}/org-access`,
      { orgIds }
    );
    return response.data;
  },
};
