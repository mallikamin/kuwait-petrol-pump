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

// Auto-Matching Types
export interface AccountingNeed {
  key: string;
  label: string;
  description: string;
  expectedQBTypes: string[];
  expectedQBSubType?: string;
  required: boolean;
  searchHints: string[];
}

export interface MatchCandidate {
  qbEntityId: string;
  qbEntityName: string;
  qbEntityType: string;
  qbEntitySubType?: string;
  score: number;
  matchReason: string;
  // Legacy support
  qbAccountId?: string;
  qbAccountName?: string;
  qbAccountType?: string;
  qbAccountSubType?: string;
  reason?: string;
}

export interface MatchItem {
  needKey: string;
  needLabel: string;
  needDescription: string;
  expectedQBTypes: string[];
  expectedQBSubType?: string;
  required: boolean;
  status: 'matched' | 'candidates' | 'unmatched';
  bestMatch: MatchCandidate | null;
  candidates: MatchCandidate[];
  decision: 'use_existing' | 'create_new' | null;
  decisionAccountId: string | null;
  decisionAccountName: string | null;
  needsClientReview?: boolean;
}

export interface EntityMatchItem {
  localId: string;
  localName: string;
  entityType: 'customer' | 'item' | 'bank';
  status: 'matched' | 'candidates' | 'unmatched';
  bestMatch: MatchCandidate | null;
  candidates: MatchCandidate[];
  decision: 'use_existing' | 'create_new' | null;
  decisionEntityId: string | null;
  decisionEntityName: string | null;
  needsClientReview?: boolean;
}

export interface MatchResult {
  id: string;
  createdAt: string;
  isLive: boolean;
  // Accounts
  accountsTotal: number;
  accountsMatched: number;
  accountsCandidates: number;
  accountsUnmatched: number;
  accountsRequired: number;
  accountsRequiredMatched: number;
  accountsCoveragePct: number;
  accountsHealthGrade: string;
  accountItems: MatchItem[];
  unmappedQBAccounts: Array<{
    qbAccountId: string;
    qbAccountName: string;
    qbAccountType: string;
    qbAccountSubType?: string;
    active: boolean;
    suggestedMappingType: string | null;
  }>;
  // Customers
  customersTotal: number;
  customersMatched: number;
  customersCandidates: number;
  customersUnmatched: number;
  customerItems: EntityMatchItem[];
  unmappedQBCustomers: Array<{
    id: string;
    name: string;
  }>;
  // Items
  itemsTotal: number;
  itemsMatched: number;
  itemsCandidates: number;
  itemsUnmatched: number;
  itemItems: EntityMatchItem[];
  unmappedQBItems: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  // Banks
  banksTotal: number;
  banksMatched: number;
  banksCandidates: number;
  banksUnmatched: number;
  bankItems: EntityMatchItem[];
  unmappedQBBanks: Array<{
    id: string;
    name: string;
  }>;
  // Overall
  overallHealthGrade: string;
  overallCoveragePct: number;
}

export interface MatchDecision {
  needKey: string;
  decision: 'use_existing' | 'create_new';
  accountId?: string;
  accountName?: string;
}

export interface EntityDecision {
  localId: string;
  decision: 'use_existing' | 'create_new';
  qbEntityId?: string;
  qbEntityName?: string;
}

export interface ApplyMatchResult {
  success: boolean;
  mappingsCreated: number;
  errors: string[];
}
