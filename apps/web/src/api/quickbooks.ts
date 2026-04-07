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

  async deleteMapping(id: string): Promise<{ success: boolean; mapping: any }> {
    const response = await apiClient.delete(`/api/quickbooks/mappings/${id}`);
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

  // Batch Undo/Revert
  async getRecentBatches(): Promise<{
    success: boolean;
    batches: Array<{
      id: string;
      entityType: string;
      createdAt: string;
      mappingsCount: number;
      isReverted: boolean;
    }>;
  }> {
    const response = await apiClient.get('/api/quickbooks/mappings/batches/recent');
    return response.data;
  },

  async previewBatch(batchId: string): Promise<{
    success: boolean;
    batch: {
      id: string;
      entityType: string;
      createdAt: string;
      mappingsCount: number;
    };
    preview: Array<{
      mappingId: string;
      entityType: string;
      localId: string;
      operation: 'CREATE' | 'UPDATE' | 'DEACTIVATE';
      beforeQbId: string | null;
      beforeQbName: string | null;
      afterQbId: string;
      afterQbName: string;
    }>;
  }> {
    const response = await apiClient.get(
      `/api/quickbooks/mappings/batches/${batchId}/preview`
    );
    return response.data;
  },

  async revertBatch(batchId: string): Promise<{
    success: boolean;
    revertedCount: number;
    failedCount: number;
    details: Array<{
      mappingId: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    const response = await apiClient.post(
      `/api/quickbooks/mappings/batches/${batchId}/revert`
    );
    return response.data;
  },

  // Manual QB Search
  async checkIfMapped(qbId: string, entityType: string): Promise<{
    success: boolean;
    isMapped: boolean;
    mappedTo?: {
      entityType: string;
      localId: string;
      localName: string;
    };
  }> {
    const response = await apiClient.get('/api/quickbooks/entities/check-mapping', {
      params: { qbId, entityType },
    });
    return response.data;
  },

  // Two-way remap
  async remapTwoWay(
    mappingId: string,
    newLocalId: string,
    newQbId: string,
    newQbName: string,
    overrideConflicts: boolean = false
  ): Promise<{
    success: boolean;
    mapping: {
      id: string;
      localId: string;
      qbId: string;
      qbName: string;
    };
    conflicts?: {
      posConflict: any;
      qbConflict: any;
    };
  }> {
    const response = await apiClient.post('/api/quickbooks/mappings/remap', {
      mappingId,
      newLocalId,
      newQbId,
      newQbName,
      overrideConflicts,
    });
    return response.data;
  },

  // Search POS entities
  async searchPosEntities(
    entityType: string,
    query: string
  ): Promise<{
    success: boolean;
    results: Array<{
      localId: string;
      localName: string;
      alreadyMapped?: boolean;
      mappedTo?: { qbId: string; qbName: string };
    }>;
  }> {
    const response = await apiClient.get('/api/quickbooks/search/pos', {
      params: { entityType, q: query },
    });
    return response.data;
  },

  // Search QB entities with mapping metadata
  async searchQbEntities(
    entityType: string,
    query: string
  ): Promise<{
    success: boolean;
    results: Array<{
      qbId: string;
      qbName: string;
      entityType: string;
      alreadyMapped: boolean;
      mappedTo?: {
        localId: string;
        localName: string;
      };
    }>;
  }> {
    const response = await apiClient.get('/api/quickbooks/search/qb', {
      params: { entityType, q: query },
    });
    return response.data;
  },

  // Export mappings
  async exportMappings(format: 'csv' | 'excel' | 'json'): Promise<{
    success: boolean;
    data: Array<{
      'Mapping Type': string;
      'POS Entity ID': string;
      'POS Entity Name': string;
      'QB Entity ID': string;
      'QB Entity Name': string;
      'Account Source': string;
      'Status': string;
      'Ask from Client': boolean;
      'Last Updated At': string;
      'Updated By': string;
      'Batch ID': string;
      'Notes': string;
    }>;
  }> {
    const response = await apiClient.get('/api/quickbooks/mappings/export', {
      params: { format },
    });
    return response.data;
  },
};
