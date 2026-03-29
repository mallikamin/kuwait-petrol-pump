import { apiClient } from './client';
import type {
  PreflightResult,
  QBControlsResponse,
  QBOAuthStatus,
  QBMappingsResponse,
  CreateMappingRequest,
  BulkMappingRequest,
  BulkMappingResponse,
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
  async getControls(): Promise<QBControlsResponse> {
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
  async getMappings(): Promise<QBMappingsResponse> {
    const response = await apiClient.get('/api/quickbooks/mappings');
    return response.data;
  },

  async createMapping(
    mapping: CreateMappingRequest
  ): Promise<{ success: boolean; mapping: any }> {
    const response = await apiClient.post('/api/quickbooks/mappings', mapping);
    return response.data;
  },

  async bulkCreateMappings(
    payload: BulkMappingRequest
  ): Promise<BulkMappingResponse> {
    const response = await apiClient.post('/api/quickbooks/mappings/bulk', payload);
    return response.data;
  },
};
