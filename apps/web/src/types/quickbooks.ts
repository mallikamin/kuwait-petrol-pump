// QuickBooks Integration Types

export type CheckStatus = 'pass' | 'warning' | 'fail';
export type OverallStatus = 'ready' | 'warning' | 'blocked';
export type SyncMode = 'READ_ONLY' | 'DRY_RUN' | 'FULL_SYNC';

export interface PreflightCheck {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, any>;
}

export interface PreflightResult {
  success: boolean;
  overallStatus: OverallStatus;
  checks: PreflightCheck[];
  summary: {
    totalChecks: number;
    passed: number;
    warnings: number;
    failed: number;
    timestamp: string;
  };
}

export interface QBControls {
  killSwitch: boolean;
  syncMode: SyncMode;
  approvalRequired: boolean;
}

export interface QBControlsResponse {
  success: boolean;
  controls: QBControls;
  status: {
    connected: boolean;
    canRead: boolean;
    canWrite: boolean;
    canWriteReal: boolean;
    isDryRun: boolean;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
  };
}

export interface QBConnection {
  companyName: string;
  realmId: string;
  syncMode: SyncMode;
  lastSyncAt: string | null;
  tokenExpiresAt: string;
}

export interface QBOAuthStatus {
  connected: boolean;
  connection?: QBConnection;
}

export interface QBEntityMapping {
  id: string;
  entityType: 'customer' | 'item' | 'payment_method';
  localId: string;
  localName: string;
  qbId: string;
  qbName: string;
  createdAt: string;
  updatedAt: string;
}

export interface QBMappingsResponse {
  success: boolean;
  count: number;
  mappings: QBEntityMapping[];
}

export interface CreateMappingRequest {
  entityType: 'customer' | 'item' | 'payment_method';
  localId: string;
  localName: string;
  qbId: string;
  qbName?: string;
}

export interface BulkMappingRequest {
  mappings: CreateMappingRequest[];
}

export interface BulkMappingResult {
  success: boolean;
  entityType: 'customer' | 'item' | 'payment_method';
  localId: string;
  qbId?: string;
  error?: string;
}

export interface BulkMappingResponse {
  success: boolean;
  totalRows: number;
  successCount: number;
  failureCount: number;
  results: BulkMappingResult[];
}
