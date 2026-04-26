import { apiClient } from './client';
import { User } from '@/types';
import type { AccessibleOrg } from '@/store/auth';

export interface AccessibleOrgsResponse {
  primaryOrgId: string;
  orgs: AccessibleOrg[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user: User;
}

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/api/auth/login', {
      username: data.username,
      password: data.password,
    });
    return response.data;
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>('/api/auth/me');
    return response.data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/api/auth/logout');
  },

  getAccessibleOrgs: async (): Promise<AccessibleOrgsResponse> => {
    const response = await apiClient.get<AccessibleOrgsResponse>('/api/auth/accessible-orgs');
    return response.data;
  },
};
