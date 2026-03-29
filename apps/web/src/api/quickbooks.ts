import { apiClient, handleApiError } from './client';
import type {
  PreflightResult,
  QBControls,
  QBOAuthStatus,
  QBEntityMapping,
  CreateMappingRequest,
  BulkMappingRequest,
  SyncMode,
} from '@/types/quickbooks';

export const quickbooksApi = {
  // OAuth
  async getOAuthStatus(): Promise<QBOAuthStatus> {
    const response = await apiClient.get('/api/quickbooks/oauth/status');
    return response.data;
  },

  async initiateOAuth(): Promise<{ authorizationUrl: string }> {
    const response = await apiClient.get('/api/quickbooks/oauth/authorize');
    return response.data;
  },

  async disconnect(): Promise<void> {
    await apiClient.post('/api/quickbooks/oauth/disconnect');
  },

  // Preflight
  async getPreflight(): Promise<PreflightResult> {
    const response = await apiClient.get('/api/quickbooks/preflight');
    return response.data;
  },

  // Controls (admin-only)
  async getControls(): Promise<QBControls> {
    const response = await apiClient.get('/api/quickbooks/controls');
    return response.data;
  },

  async updateControls(payload: {
    killSwitch?: boolean;
    syncMode?: SyncMode;
  }): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post('/api/quickbooks/controls', payload);
    return response.data;
  },

  // Entity Mappings
  async getMappings(): Promise<QBEntityMapping[]> {
    const response = await apiClient.get('/api/quickbooks/mappings');
    return response.data;
  },

  async createMapping(
    mapping: CreateMappingRequest
  ): Promise<{ success: boolean; mapping: QBEntityMapping }> {
    const response = await apiClient.post('/api/quickbooks/mappings', mapping);
    return response.data;
  },

  async bulkCreateMappings(
    payload: BulkMappingRequest
  ): Promise<{ success: boolean; created: number; errors: string[] }> {
    const response = await apiClient.post('/api/quickbooks/mappings/bulk', payload);
    return response.data;
  },

  async deleteMapping(id: string): Promise<void> {
    await apiClient.delete(`/api/quickbooks/mappings/${id}`);
  },
};
