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

  // Auto-Matching Workflow
  async getNeeds(): Promise<{ success: boolean; needs: any[] }> {
    const response = await apiClient.get('/api/quickbooks/needs');
    return response.data;
  },

  async runMatch(): Promise<{ success: boolean; result: any }> {
    const response = await apiClient.post('/api/quickbooks/match/run');
    return response.data;
  },

  async getMatchResult(matchId: string): Promise<{ success: boolean; result: any }> {
    const response = await apiClient.get(`/api/quickbooks/match/${matchId}`);
    return response.data;
  },

  async updateMatchDecisions(
    matchId: string,
    decisions: any[]
  ): Promise<{ success: boolean; result: any }> {
    const response = await apiClient.post(`/api/quickbooks/match/${matchId}/decisions`, {
      decisions,
    });
    return response.data;
  },

  async applyMatch(matchId: string): Promise<{ success: boolean; result: any }> {
    const response = await apiClient.post(`/api/quickbooks/match/${matchId}/apply`);
    return response.data;
  },

  async updateEntityDecisions(
    matchId: string,
    entityType: 'customer' | 'item' | 'bank',
    decisions: any[]
  ): Promise<{ success: boolean; result: any }> {
    const response = await apiClient.post(
      `/api/quickbooks/match/${matchId}/entity-decisions`,
      { entityType, decisions }
    );
    return response.data;
  },

  async applyEntityMappings(
    matchId: string,
    entityType: 'customer' | 'item' | 'bank'
  ): Promise<{ success: boolean; result: any }> {
    const response = await apiClient.post(
      `/api/quickbooks/match/${matchId}/apply-entities`,
      { entityType }
    );
    return response.data;
  },

  async getUnmappedPreflight(): Promise<{
    success: boolean;
    hasBlockers: boolean;
    totalUnmapped: number;
    unmapped: any;
    summary: any;
  }> {
    const response = await apiClient.get('/api/quickbooks/preflight/unmapped');
    return response.data;
  },
};
