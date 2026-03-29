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
  localEntityId: string;
  localName: string;
  qbEntityId: string;
  qbName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMappingRequest {
  entityType: 'customer' | 'item' | 'payment_method';
  localEntityId: string;
  localName: string;
  qbEntityId: string;
  qbName: string;
}

export interface BulkMappingRequest {
  mappings: CreateMappingRequest[];
}
