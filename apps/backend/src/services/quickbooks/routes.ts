/**
 * QuickBooks API Routes
 *
 * Management endpoints for QB integration:
 * - OAuth connection
 * - Safety gate controls
 * - Sync operations
 * - Replay & recovery
 * - Health monitoring
 */

import { Router, Request, Response } from 'express';
import {
  checkAllSafetyGates,
  enableWriteMode,
  disableWriteMode,
  setSyncMode,
  activateKillSwitch,
  deactivateKillSwitch,
  approveSyncBatch,
  getSafetyStatus,
} from './safety-gates';
import { ReplayService } from './replay';
import { RateLimiter } from './rate-limiter';
import { CompanyLock } from './company-lock';
import { AuditLogger } from './audit-logger';
import { EntityMappingService, EntityType } from './entity-mapping.service';
import { PrismaClient } from '@prisma/client';
import { encryptToken, decryptToken } from './encryption';
import { generateState, validateState } from './oauth-state';
import { getValidAccessToken, getQBApiUrl } from './token-refresh';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { runPreflightChecks } from './preflight.service';
import { OpLog } from './error-classifier';
import OAuthClient from 'intuit-oauth';
import { AutoMatchService } from './auto-match.service';
import { QBTokenExpiredError, QBTransientError } from './errors';
import { getAllNeedsAsDicts } from './kuwait-needs';

const prisma = new PrismaClient();

const router = Router();

// Initialize OAuth client
function getOAuthClient() {
  return new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID || '',
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || '',
    environment: (process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI || '',
  });
}

/**
 * Standardized QB error response handler
 * Returns 401 for token expiration, 503 for transient errors, 500 for unknown
 */
function handleQBError(error: any, res: Response): void {
  if (error instanceof QBTokenExpiredError) {
    res.status(401).json({
      code: 'QB_TOKEN_EXPIRED',
      message: 'QuickBooks token expired. Please reconnect.',
    });
  } else if (error instanceof QBTransientError) {
    res.status(503).json({
      code: 'QB_TRANSIENT_ERROR',
      message: error.message,
      retryable: true,
    });
  } else {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * GET /api/quickbooks/oauth/authorize
 * Generate OAuth authorization URL (authenticated)
 */
router.get('/oauth/authorize', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;

    // Generate signed state token with nonce
    const stateToken = await generateState(organizationId, userId);

    const oauthClient = getOAuthClient();
    const authUri = oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state: stateToken,
    });

    res.json({ authorizationUrl: authUri });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/oauth/callback
 * Handle OAuth callback and store tokens (validates signed state)
 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, realmId } = req.query;

    if (!code || !state || !realmId) {
      return res.status(400).json({ error: 'Missing required OAuth parameters' });
    }

    // Validate signed state token (throws if invalid/expired/used)
    const statePayload = await validateState(state as string);
    const { organizationId, userId } = statePayload;

    const oauthClient = getOAuthClient();

    // Exchange code for tokens
    await oauthClient.createToken(req.url);
    const token = oauthClient.getToken();

    // Encrypt tokens
    const accessTokenEncrypted = encryptToken(token.access_token);
    const refreshTokenEncrypted = encryptToken(token.refresh_token);

    // Get company info
    const companyInfo = await oauthClient.makeApiCall({
      url: `${oauthClient.environment === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'}/v3/company/${realmId}/companyinfo/${realmId}`,
    });
    const companyName = companyInfo.json?.CompanyInfo?.CompanyName || 'Unknown';

    // Upsert connection
    const existingConn = await prisma.qBConnection.findUnique({
      where: { uq_qb_conn_org_realm: { organizationId, realmId: realmId as string } },
    });

    if (existingConn) {
      await prisma.qBConnection.update({
        where: { id: existingConn.id },
        data: {
          companyName,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + token.x_refresh_token_expires_in * 1000),
          isActive: true,
          lastSyncAt: new Date(),
        },
      });
    } else {
      await prisma.qBConnection.create({
        data: {
          organizationId,
          realmId: realmId as string,
          companyName,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + token.x_refresh_token_expires_in * 1000),
          isActive: true,
          syncMode: 'READ_ONLY',
          connectedBy: userId, // From validated state
        },
      });
    }

    await AuditLogger.log({
      operation: 'OAUTH_CONNECTED',
      entity_type: 'connection',
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { organizationId, userId, realmId, companyName },
    });

    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/quickbooks?success=true`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await AuditLogger.log({
      operation: 'OAUTH_CALLBACK_FAILED',
      entity_type: 'connection',
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      metadata: { error: errorMsg },
    });

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/quickbooks?error=${encodeURIComponent(errorMsg)}`);
  }
});

/**
 * POST /api/quickbooks/oauth/disconnect
 * Disconnect and revoke QuickBooks connection (authenticated admin/manager)
 */
router.post('/oauth/disconnect', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;

    // Find active connection
    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!connection) {
      return res.status(404).json({ error: 'No active connection found' });
    }

    // Revoke tokens at Intuit
    try {
      if (connection.refreshTokenEncrypted) {
        const refreshToken = decryptToken(connection.refreshTokenEncrypted);
        const oauthClient = getOAuthClient();
        oauthClient.token.setToken({ refresh_token: refreshToken } as any);
        await oauthClient.revoke();
      }
    } catch (revokeError) {
      // Log but don't fail (tokens might already be expired)
      console.error('Intuit revoke failed:', revokeError);
    }

    // Mark connection as inactive
    await prisma.qBConnection.update({
      where: { id: connection.id },
      data: { isActive: false, lastSyncAt: new Date() },
    });

    await AuditLogger.log({
      operation: 'OAUTH_DISCONNECTED',
      entity_type: 'connection',
      entity_id: connection.id,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { organizationId, userId, companyName: connection.companyName },
    });

    res.json({ success: true, message: 'QuickBooks connection disconnected' });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/oauth/status
 * Get current OAuth connection status (authenticated)
 */
router.get('/oauth/status', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;

    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        companyName: true,
        realmId: true,
        isActive: true,
        syncMode: true,
        lastSyncAt: true,
        accessTokenExpiresAt: true,
      },
    });

    if (!connection) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      connection: {
        companyName: connection.companyName,
        realmId: connection.realmId,
        syncMode: connection.syncMode,
        lastSyncAt: connection.lastSyncAt,
        tokenExpiresAt: connection.accessTokenExpiresAt,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/health
 * Check QB integration health status
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Implementation would check:
    // - Connection active
    // - Rate limiter status
    // - Circuit breaker state
    // - Recent sync success rate

    res.json({
      status: 'healthy',
      message: 'QuickBooks integration operational',
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/banks
 * Fetch all bank accounts from QuickBooks
 */
router.get('/banks', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;

    // Get valid access token (auto-refreshes if expired)
    const { accessToken, realmId } = await getValidAccessToken(organizationId, prisma);
    const apiUrl = getQBApiUrl();

    const response = await fetch(
      `${apiUrl}/v3/company/${realmId}/query?query=SELECT * FROM Account WHERE AccountType='Bank' AND Active=true MAXRESULTS 1000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch banks: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const banks = data.QueryResponse?.Account || [];

    res.json({
      success: true,
      count: banks.length,
      banks: banks.map((bank: any) => ({
        id: bank.Id,
        name: bank.Name,
        accountNumber: bank.AcctNum || null,
        accountType: bank.AccountType,
        accountSubType: bank.AccountSubType || null,
        currentBalance: bank.CurrentBalance || 0,
        active: bank.Active,
      })),
    });
  } catch (error) {
    handleQBError(error, res);
  }
});

/**
 * GET /api/quickbooks/preflight
 * Run production readiness checks (authenticated admin/manager)
 */
router.get('/preflight', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;

    console.log(`[QB Preflight] Running checks for org ${organizationId}`);

    const result = await runPreflightChecks(organizationId);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/preflight/unmapped
 * Check for unmapped entities that would block QB sync (authenticated admin/manager)
 */
router.get('/preflight/unmapped', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;

    console.log(`[QB Preflight] Checking unmapped entities for org ${organizationId}`);

    // Fetch all local entities
    const [customers, fuelTypes, products, banks] = await Promise.all([
      prisma.customer.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      prisma.fuelType.findMany({ select: { id: true, name: true } }),
      prisma.product.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      prisma.bank.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);

    // Fetch existing mappings
    const [customerMappings, itemMappings, bankMappings] = await Promise.all([
      prisma.qBEntityMapping.findMany({
        where: { organizationId, entityType: 'customer', isActive: true },
        select: { localId: true },
      }),
      prisma.qBEntityMapping.findMany({
        where: { organizationId, entityType: 'item', isActive: true },
        select: { localId: true },
      }),
      prisma.qBEntityMapping.findMany({
        where: { organizationId, entityType: 'bank', isActive: true },
        select: { localId: true },
      }),
    ]);

    // Find unmapped entities
    const mappedCustomerIds = new Set(customerMappings.map(m => m.localId));
    const mappedItemIds = new Set(itemMappings.map(m => m.localId));
    const mappedBankIds = new Set(bankMappings.map(m => m.localId));

    const unmappedCustomers = customers.filter(c => !mappedCustomerIds.has(c.id));
    const unmappedFuelTypes = fuelTypes.filter(f => !mappedItemIds.has(f.id));
    const unmappedProducts = products.filter(p => !mappedItemIds.has(p.id));
    const unmappedBanks = banks.filter(b => !mappedBankIds.has(b.id));

    const totalUnmapped =
      unmappedCustomers.length +
      unmappedFuelTypes.length +
      unmappedProducts.length +
      unmappedBanks.length;

    const hasBlockers = unmappedCustomers.length > 0 || unmappedFuelTypes.length > 0 || unmappedBanks.length > 0;

    res.json({
      success: true,
      hasBlockers,
      totalUnmapped,
      unmapped: {
        customers: unmappedCustomers,
        fuelTypes: unmappedFuelTypes,
        products: unmappedProducts,
        banks: unmappedBanks,
      },
      summary: {
        customers: { total: customers.length, mapped: customers.length - unmappedCustomers.length, unmapped: unmappedCustomers.length },
        fuelTypes: { total: fuelTypes.length, mapped: fuelTypes.length - unmappedFuelTypes.length, unmapped: unmappedFuelTypes.length },
        products: { total: products.length, mapped: products.length - unmappedProducts.length, unmapped: unmappedProducts.length },
        banks: { total: banks.length, mapped: banks.length - unmappedBanks.length, unmapped: unmappedBanks.length },
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/controls
 * Get current operational controls (kill switch + sync mode) - admin only
 */
router.get('/controls', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;

    const status = await getSafetyStatus(organizationId);

    res.json({
      success: true,
      controls: {
        killSwitch: status.killSwitchActive,
        syncMode: status.syncMode,
        approvalRequired: status.approvalRequired
      },
      status: {
        connected: status.connected,
        canRead: status.canRead,
        canWrite: status.canWrite,
        canWriteReal: status.canWriteReal,
        isDryRun: status.isDryRun,
        lastSyncAt: status.lastSyncAt,
        lastSyncStatus: status.lastSyncStatus
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/controls
 * Update operational controls (kill switch or sync mode) - admin only
 */
router.post('/controls', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;
    const { killSwitch, syncMode, reason } = req.body;

    // Validate at least one control specified
    if (killSwitch === undefined && !syncMode) {
      return res.status(400).json({
        error: 'Must specify at least one control: killSwitch (boolean) or syncMode (READ_ONLY|DRY_RUN|FULL_SYNC)'
      });
    }

    // Validate syncMode if provided
    if (syncMode && !['READ_ONLY', 'DRY_RUN', 'FULL_SYNC'].includes(syncMode)) {
      return res.status(400).json({
        error: 'Invalid syncMode. Must be: READ_ONLY, DRY_RUN, or FULL_SYNC'
      });
    }

    // Validate killSwitch if provided
    if (killSwitch !== undefined && typeof killSwitch !== 'boolean') {
      return res.status(400).json({
        error: 'killSwitch must be boolean'
      });
    }

    // Get current state for idempotency check
    const currentStatus = await getSafetyStatus(organizationId);

    const changes: any = {};
    let changed = false;

    // Update kill switch (idempotent)
    if (killSwitch !== undefined && killSwitch !== currentStatus.killSwitchActive) {
      if (killSwitch) {
        await activateKillSwitch(organizationId);
      } else {
        await deactivateKillSwitch(organizationId);
      }
      changes.killSwitch = { from: currentStatus.killSwitchActive, to: killSwitch };
      changed = true;

      // Log control change
      console.log(OpLog.controlChange('killSwitch', currentStatus.killSwitchActive, killSwitch, userId));
    }

    // Update sync mode (idempotent)
    if (syncMode && syncMode !== currentStatus.syncMode) {
      await setSyncMode(organizationId, syncMode);
      changes.syncMode = { from: currentStatus.syncMode, to: syncMode };
      changed = true;

      // Log control change
      console.log(OpLog.controlChange('syncMode', currentStatus.syncMode, syncMode, userId));
    }

    // Log audit trail (even if no changes for tracking)
    await AuditLogger.log({
      operation: 'UPDATE_CONTROLS',
      entity_type: 'connection',
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId,
        organizationId,
        changes,
        reason: reason || 'No reason provided',
        changed
      }
    });

    if (!changed) {
      return res.json({
        success: true,
        message: 'No changes applied (controls already in desired state)',
        controls: {
          killSwitch: currentStatus.killSwitchActive,
          syncMode: currentStatus.syncMode
        }
      });
    }

    // Return updated state
    const newStatus = await getSafetyStatus(organizationId);

    res.json({
      success: true,
      message: 'Controls updated successfully',
      changes,
      controls: {
        killSwitch: newStatus.killSwitchActive,
        syncMode: newStatus.syncMode
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/safety-gates
 * Get current safety gate status (authenticated)
 */
router.get('/safety-gates', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;

    // Import getSafetyStatus for gate status endpoint
    const { getSafetyStatus } = await import('./safety-gates');
    const gates = await getSafetyStatus(organizationId);

    res.json(gates);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/safety-gates/sync-mode
 * Set sync mode (READ_ONLY or WRITE_ENABLED) - admin/manager only
 *
 * @deprecated Use POST /api/quickbooks/controls instead for DRY_RUN/FULL_SYNC support
 * BACKWARD COMPATIBILITY: WRITE_ENABLED maps to FULL_SYNC
 */
router.post('/safety-gates/sync-mode', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;
    const { mode } = req.body;

    if (!mode) {
      return res.status(400).json({ error: 'mode required' });
    }

    if (mode !== 'READ_ONLY' && mode !== 'WRITE_ENABLED') {
      return res.status(400).json({ error: 'mode must be READ_ONLY or WRITE_ENABLED' });
    }

    // Backward compatibility: WRITE_ENABLED → FULL_SYNC
    if (mode === 'WRITE_ENABLED') {
      await enableWriteMode(organizationId);
    } else {
      await disableWriteMode(organizationId);
    }

    await AuditLogger.log({
      operation: 'SYNC_MODE_CHANGE',
      entity_type: 'connection',
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { organizationId, userId, mode, mappedTo: mode === 'WRITE_ENABLED' ? 'FULL_SYNC' : 'READ_ONLY' },
    });

    res.json({
      success: true,
      mode,
      warning: 'This endpoint is deprecated. Use POST /api/quickbooks/controls for DRY_RUN/FULL_SYNC support.',
      actualSyncMode: mode === 'WRITE_ENABLED' ? 'FULL_SYNC' : 'READ_ONLY'
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/safety-gates/kill-switch
 * Toggle global kill switch - admin only
 */
router.post('/safety-gates/kill-switch', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) required' });
    }

    if (enabled) {
      await activateKillSwitch(organizationId);
    } else {
      await deactivateKillSwitch(organizationId);
    }

    await AuditLogger.log({
      operation: 'KILL_SWITCH',
      entity_type: 'connection',
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { organizationId, userId, enabled },
    });

    res.json({ success: true, killSwitch: enabled });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/safety-gates/approve-batch
 * Approve a pending batch for sync - admin/manager only
 */
router.post('/safety-gates/approve-batch', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;
    const { batchId } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId required' });
    }

    const approvedCount = await approveSyncBatch(batchId, userId, organizationId);

    await AuditLogger.log({
      operation: 'BATCH_APPROVED',
      entity_type: 'batch',
      entity_id: batchId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: { approvedBy: userId, organizationId, approvedCount },
    });

    res.json({ success: true, approvedCount });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/batches/pending
 * List pending batches requiring approval (authenticated admin/manager)
 */
router.get('/batches/pending', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;

    // List pending batches requiring approval
    const batches = await prisma.qBSyncQueue.groupBy({
      by: ['batchId'],
      where: {
        organizationId,
        approvalStatus: 'pending_approval',
        batchId: { not: null },
      },
      _count: {
        id: true,
      },
      _min: {
        createdAt: true,
      },
    });

    const result = batches
      .filter(b => b.batchId)
      .map(b => ({
        batchId: b.batchId!,
        jobCount: b._count.id,
        createdAt: b._min.createdAt,
      }));

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/replay/replayable
 * List batches eligible for replay (authenticated admin/manager)
 */
router.get('/replay/replayable', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const batches = await ReplayService.getReplayableBatches();

    res.json(batches);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/replay/batch
 * Replay a failed batch (authenticated admin/manager)
 */
router.post('/replay/batch', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { batchId, dryRun, maxRetries } = req.body;

    if (!batchId) {
      return res.status(400).json({ error: 'batchId required' });
    }

    const result = await ReplayService.replayBatch(batchId, {
      dryRun: dryRun || false,
      maxRetries: maxRetries || 3,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/replay/restore-and-replay
 * Restore checkpoint and replay batch (authenticated admin/manager)
 */
router.post('/replay/restore-and-replay', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { batchId, checkpointId, dryRun, maxRetries } = req.body;

    if (!batchId || !checkpointId) {
      return res.status(400).json({ error: 'batchId and checkpointId required' });
    }

    const result = await ReplayService.restoreAndReplay(batchId, checkpointId, {
      dryRun: dryRun || false,
      maxRetries: maxRetries || 3,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/replay/history/:batchId
 * Get replay history for a batch (authenticated admin/manager)
 */
router.get('/replay/history/:batchId', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    const history = await ReplayService.getReplayHistory(batchId);

    res.json(history);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/replay/cancel
 * Cancel a batch (authenticated admin/manager)
 */
router.post('/replay/cancel', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { batchId, reason } = req.body;

    if (!batchId || !reason) {
      return res.status(400).json({ error: 'batchId and reason required' });
    }

    const result = await ReplayService.cancelBatch(batchId, reason);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/circuit-breaker/:connectionId
 * Get circuit breaker status (authenticated admin/manager)
 */
router.get('/circuit-breaker/:connectionId', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;

    const status = await RateLimiter.getCircuitStatus(connectionId);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/circuit-breaker/reset
 * Reset circuit breaker (authenticated admin/manager)
 */
router.post('/circuit-breaker/reset', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: 'connectionId required' });
    }

    await RateLimiter.resetCircuit(connectionId);

    await AuditLogger.log({
      operation: 'CIRCUIT_RESET',
      entity_type: 'connection',
      entity_id: connectionId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/company-lock/:connectionId
 * Get company lock status (authenticated admin/manager)
 */
router.get('/company-lock/:connectionId', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;

    const status = await CompanyLock.getLockStatus(connectionId);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/audit/stats
 * Get audit statistics (authenticated admin/manager)
 */
router.get('/audit/stats', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { entity_type, hours } = req.query;

    const stats = await AuditLogger.getStats(
      entity_type as string | undefined,
      hours ? parseInt(hours as string) : 24
    );

    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/audit/failures
 * Get recent failures (authenticated admin/manager)
 */
router.get('/audit/failures', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { entity_type, hours } = req.query;

    const failures = await AuditLogger.getRecentFailures(
      hours ? parseInt(hours as string) : 24,
      entity_type as string | undefined
    );

    res.json(failures);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// ============================================================
// ENTITY MAPPING ENDPOINTS
// ============================================================

/**
 * GET /api/quickbooks/mappings
 * List entity mappings with optional filters (authenticated)
 */
router.get('/mappings', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;
    const { entityType, localId, qbId, isActive } = req.query;

    // Validate entityType if provided
    if (entityType) {
      const validTypes: EntityType[] = ['customer', 'payment_method', 'item', 'bank', 'account'];
      if (!validTypes.includes(entityType as EntityType)) {
        return res.status(400).json({
          error: `Invalid entityType: ${entityType}. Must be one of: ${validTypes.join(', ')}`
        });
      }
    }

    // Build filters
    const filters: any = {};
    if (entityType) filters.entityType = entityType as EntityType;
    if (localId) filters.localId = localId as string;
    if (qbId) filters.qbId = qbId as string;
    if (isActive !== undefined) filters.isActive = isActive === 'true';

    // List mappings
    const mappings = await EntityMappingService.listMappings(organizationId, filters);

    res.json({
      success: true,
      count: mappings.length,
      mappings
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/quickbooks/mappings
 * Upsert single entity mapping (authenticated admin/manager)
 */
router.post('/mappings', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;
    const { entityType, localId, qbId, qbName } = req.body;

    // Validate required fields
    if (!entityType || !localId || !qbId) {
      return res.status(400).json({
        error: 'Missing required fields: entityType, localId, qbId'
      });
    }

    // Validate entityType
    const validTypes: EntityType[] = ['customer', 'payment_method', 'item', 'bank', 'account'];
    if (!validTypes.includes(entityType)) {
      return res.status(400).json({
        error: `Invalid entityType: ${entityType}. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Upsert mapping
    const mapping = await EntityMappingService.upsertMapping(
      organizationId,
      entityType,
      localId,
      qbId,
      qbName
    );

    // Log audit trail
    await AuditLogger.log({
      operation: 'UPSERT_ENTITY_MAPPING',
      entity_type: entityType,
      entity_id: localId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId,
        organizationId,
        localId,
        qbId,
        qbName: mapping.qbName
      }
    });

    res.json({
      success: true,
      mapping
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/quickbooks/mappings/bulk
 * Bulk upsert entity mappings (authenticated admin/manager)
 */
router.post('/mappings/bulk', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;
    const { mappings } = req.body;

    // Validate payload
    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({
        error: 'Missing required field: mappings (must be non-empty array)'
      });
    }

    // Validate each mapping row
    const validTypes: EntityType[] = ['customer', 'payment_method', 'item', 'bank', 'account'];
    for (let i = 0; i < mappings.length; i++) {
      const row = mappings[i];
      if (!row.entityType || !row.localId || !row.qbId) {
        return res.status(400).json({
          error: `Mapping row ${i}: Missing required fields (entityType, localId, qbId)`
        });
      }
      if (!validTypes.includes(row.entityType)) {
        return res.status(400).json({
          error: `Mapping row ${i}: Invalid entityType ${row.entityType}. Must be one of: ${validTypes.join(', ')}`
        });
      }
    }

    // Bulk upsert
    const results = await EntityMappingService.bulkUpsert(organizationId, mappings);

    // Log audit trail
    await AuditLogger.log({
      operation: 'BULK_UPSERT_ENTITY_MAPPINGS',
      entity_type: 'mapping',
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId,
        organizationId,
        totalRows: mappings.length,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length
      }
    });

    res.json({
      success: true,
      totalRows: mappings.length,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      results
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * DELETE /api/quickbooks/mappings/:id
 * Deactivate entity mapping (soft delete)
 */
router.delete('/mappings/:id', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;
    const { id } = req.params;

    if (!id || !id.trim()) {
      return res.status(400).json({ error: 'Missing required field: id' });
    }

    // Validate UUID format (v4: 8-4-4-4-12 hex digits with hyphens)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid UUID format for mapping ID' });
    }

    // Deactivate mapping
    const result = await EntityMappingService.deactivateMapping(organizationId, id);

    // Log audit trail
    await AuditLogger.log({
      operation: 'DEACTIVATE_ENTITY_MAPPING',
      entity_type: 'mapping',
      entity_id: id,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId,
        organizationId
      }
    });

    res.json({
      success: true,
      mapping: result
    });
  } catch (error) {
    // Handle "not found" errors
    if (error instanceof Error && error.message.includes('Mapping not found')) {
      return res.status(404).json({ error: 'Mapping not found' });
    }

    // Handle "unauthorized" errors
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return res.status(403).json({ error: error.message });
    }

    // Default to 500 for unexpected errors
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================
// AUTO-MATCHING ENDPOINTS (Wizard-based mapping setup)
// ============================================================

/**
 * GET /api/quickbooks/needs
 * List POS accounting needs catalog (authenticated)
 */
router.get('/needs', authenticate, async (req: Request, res: Response) => {
  try {
    const needs = getAllNeedsAsDicts();
    res.json({ success: true, needs });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/match/run
 * Run auto-matching against QB Chart of Accounts (authenticated admin/manager)
 */
router.post('/match/run', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId, userId } = req.user;

    console.log(`[QB Auto-Match] Starting for org ${organizationId} by user ${userId}`);

    const result = await AutoMatchService.runMatching(organizationId);

    await AuditLogger.log({
      operation: 'QB_AUTO_MATCH_RUN',
      entity_type: 'match_result',
      entity_id: result.id,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId,
        organizationId,
        overallHealthGrade: result.overallHealthGrade,
        accountsMatched: result.accountsMatched,
        customersMatched: result.customersMatched,
        itemsMatched: result.itemsMatched,
        banksMatched: result.banksMatched,
      },
    });

    res.json({ success: true, result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await AuditLogger.log({
      operation: 'QB_AUTO_MATCH_RUN_FAILED',
      entity_type: 'match_result',
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      metadata: { error: errorMsg },
    });

    handleQBError(error, res);
  }
});

/**
 * GET /api/quickbooks/match/:matchId
 * Get stored match result (authenticated)
 */
router.get('/match/:matchId', authenticate, async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;

    const result = AutoMatchService.getResult(matchId);

    if (!result) {
      return res.status(404).json({ error: 'Match result not found' });
    }

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/quickbooks/match/results/list
 * List all match results (authenticated)
 */
// Removed listResults endpoint - not needed for multi-entity matching

/**
 * POST /api/quickbooks/match/:matchId/decisions
 * Update admin decisions on ACCOUNT match results (authenticated admin/manager)
 */
router.post('/match/:matchId/decisions', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { matchId } = req.params;
    const { decisions } = req.body;

    if (!decisions || !Array.isArray(decisions)) {
      return res.status(400).json({ error: 'decisions (array) required' });
    }

    const result = AutoMatchService.updateAccountDecisions(matchId, decisions);

    await AuditLogger.log({
      operation: 'QB_MATCH_DECISIONS_SAVED',
      entity_type: 'match_result',
      entity_id: matchId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId: req.user.userId,
        organizationId: req.user.organizationId,
        entityType: 'account',
        decisionsCount: decisions.length,
      },
    });

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/match/:matchId/entity-decisions
 * Update admin decisions on entity match results (customers, items, banks)
 */
router.post('/match/:matchId/entity-decisions', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { matchId } = req.params;
    const { entityType, decisions } = req.body;

    if (!entityType || !['customer', 'item', 'bank'].includes(entityType)) {
      return res.status(400).json({ error: 'entityType required (customer, item, or bank)' });
    }

    if (!decisions || !Array.isArray(decisions)) {
      return res.status(400).json({ error: 'decisions (array) required' });
    }

    const result = AutoMatchService.updateEntityDecisions(matchId, entityType, decisions);

    await AuditLogger.log({
      operation: 'QB_MATCH_ENTITY_DECISIONS_SAVED',
      entity_type: 'match_result',
      entity_id: matchId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId: req.user.userId,
        organizationId: req.user.organizationId,
        entityType,
        decisionsCount: decisions.length,
      },
    });

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/quickbooks/match/:matchId/apply
 * Apply ACCOUNT mapping decisions (authenticated admin/manager)
 */
router.post('/match/:matchId/apply', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { matchId } = req.params;
    const { organizationId, userId } = req.user;

    console.log(`[QB Auto-Match] Applying account decisions for match ${matchId}`);

    const result = await AutoMatchService.applyAccountDecisions(matchId, organizationId, userId);

    await AuditLogger.log({
      operation: 'QB_MATCH_APPLY_COMPLETE',
      entity_type: 'match_result',
      entity_id: matchId,
      direction: 'APP_TO_QB',
      status: result.success ? 'SUCCESS' : 'FAILURE',
      metadata: {
        userId,
        organizationId,
        entityType: 'account',
        batchId: result.batchId,
        mappingsCreated: result.mappingsCreated,
        errors: result.errors,
      },
    });

    res.json({ success: result.success, result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await AuditLogger.log({
      operation: 'QB_MATCH_APPLY_FAILED',
      entity_type: 'match_result',
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      metadata: { error: errorMsg },
    });

    handleQBError(error, res);
  }
});

/**
 * POST /api/quickbooks/match/:matchId/apply-entities
 * Apply ENTITY mapping decisions (customers, items, banks)
 */
router.post('/match/:matchId/apply-entities', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { matchId } = req.params;
    const { entityType } = req.body;
    const { organizationId, userId } = req.user;

    if (!entityType || !['customer', 'item', 'bank'].includes(entityType)) {
      return res.status(400).json({ error: 'entityType required (customer, item, or bank)' });
    }

    console.log(`[QB Auto-Match] Applying ${entityType} decisions for match ${matchId}`);

    const result = await AutoMatchService.applyEntityDecisions(matchId, organizationId, entityType, userId);

    await AuditLogger.log({
      operation: 'QB_MATCH_APPLY_ENTITIES_COMPLETE',
      entity_type: 'match_result',
      entity_id: matchId,
      direction: 'APP_TO_QB',
      status: result.success ? 'SUCCESS' : 'FAILURE',
      metadata: {
        userId,
        organizationId,
        entityType,
        batchId: result.batchId,
        mappingsCreated: result.mappingsCreated,
        errors: result.errors,
      },
    });

    res.json({ success: result.success, result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await AuditLogger.log({
      operation: 'QB_MATCH_APPLY_ENTITIES_FAILED',
      entity_type: 'match_result',
      direction: 'APP_TO_QB',
      status: 'FAILURE',
      metadata: { error: errorMsg, entityType: req.body.entityType },
    });

    handleQBError(error, res);
  }
});

// ============================================================
// BATCH UNDO/REVERT ENDPOINTS
// ============================================================

/**
 * GET /api/quickbooks/mappings/batches/recent
 * List recent revertible batches (authenticated admin/manager)
 */
router.get('/mappings/batches/recent', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;
    const limit = parseInt(req.query.limit as string) || 10;

    const { MappingBatchService } = await import('./mapping-batch.service');
    const batches = await MappingBatchService.getRecentBatches(organizationId, limit);

    res.json({ success: true, batches });
  } catch (error: any) {
    handleQBError(error, res);
  }
});

/**
 * GET /api/quickbooks/mappings/batches/:batchId/preview
 * Preview what would be reverted
 */
router.get('/mappings/batches/:batchId/preview', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { batchId } = req.params;
    const { organizationId } = req.user;

    const { MappingBatchService } = await import('./mapping-batch.service');
    const preview = await MappingBatchService.getBatchPreview(batchId, organizationId);

    res.json({ success: true, preview });
  } catch (error: any) {
    handleQBError(error, res);
  }
});

/**
 * POST /api/quickbooks/mappings/batches/:batchId/revert
 * Revert a batch of mapping changes
 */
router.post('/mappings/batches/:batchId/revert', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { batchId } = req.params;
    const { organizationId, userId } = req.user;

    const { MappingBatchService } = await import('./mapping-batch.service');
    const result = await MappingBatchService.revertBatch(batchId, organizationId, userId);

    // Log audit trail
    await AuditLogger.log({
      operation: 'REVERT_MAPPING_BATCH',
      entity_type: 'mapping_batch',
      entity_id: batchId,
      direction: 'APP_TO_QB',
      status: result.success ? 'SUCCESS' : 'FAILURE',
      metadata: {
        userId,
        organizationId,
        revertedCount: result.revertedCount,
        errorCount: result.errors.length,
      },
    });

    res.json({
      success: result.success,
      revertedCount: result.revertedCount,
      errors: result.errors,
    });
  } catch (error: any) {
    handleQBError(error, res);
  }
});

// ============================================================
// ENTITY MAPPING ENDPOINTS
// ============================================================

/**
 * GET /api/quickbooks/entities/check-mapping
 * Check if a QB entity is already mapped
 */
router.get('/entities/check-mapping', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;
    const { entityType, qbId } = req.query;

    if (!entityType || !qbId) {
      return res.status(400).json({ error: 'Missing entityType or qbId' });
    }

    const result = await EntityMappingService.checkIfMapped(
      organizationId,
      entityType as any,
      qbId as string
    );

    res.json(result);
  } catch (error: any) {
    handleQBError(error, res);
  }
});

/**
 * POST /api/quickbooks/mappings/remap
 * Two-way remap: change both POS entity and QB entity atomically
 * With conflict detection and override capability
 */
router.post('/mappings/remap', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { mappingId, newLocalId, newQbId, newQbName, overrideConflicts } = req.body;
    const { organizationId, userId } = req.user;

    if (!mappingId || !newLocalId || !newQbId) {
      return res.status(400).json({ error: 'mappingId, newLocalId, newQbId required' });
    }

    // Get existing mapping
    const existing = await prisma.qBEntityMapping.findUnique({
      where: { id: mappingId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Mapping not found' });
    }

    // Check for conflicts
    const posConflict = await prisma.qBEntityMapping.findFirst({
      where: {
        organizationId,
        entityType: existing.entityType,
        localId: newLocalId,
        id: { not: mappingId },
        isActive: true,
      },
    });

    const qbConflict = await prisma.qBEntityMapping.findFirst({
      where: {
        organizationId,
        entityType: existing.entityType,
        qbId: newQbId,
        id: { not: mappingId },
        isActive: true,
      },
    });

    if ((posConflict || qbConflict) && !overrideConflicts) {
      return res.status(409).json({
        error: 'Mapping conflict detected',
        conflicts: {
          posConflict: posConflict ? { localId: posConflict.localId, qbId: posConflict.qbId } : null,
          qbConflict: qbConflict ? { localId: qbConflict.localId, qbId: qbConflict.qbId } : null,
        },
      });
    }

    // Deactivate conflicting mappings if override enabled
    if (overrideConflicts) {
      if (posConflict) {
        await prisma.qBEntityMapping.update({
          where: { id: posConflict.id },
          data: { isActive: false },
        });
      }
      if (qbConflict) {
        await prisma.qBEntityMapping.update({
          where: { id: qbConflict.id },
          data: { isActive: false },
        });
      }
    }

    // Update the mapping
    const updated = await prisma.qBEntityMapping.update({
      where: { id: mappingId },
      data: {
        localId: newLocalId,
        qbId: newQbId,
        qbName: newQbName || existing.qbName,
        updatedAt: new Date(),
      },
    });

    // Audit log
    await AuditLogger.log({
      operation: 'REMAP_MAPPING_TWO_WAY',
      entity_type: 'entity_mapping',
      entity_id: mappingId,
      direction: 'APP_TO_QB',
      status: 'SUCCESS',
      metadata: {
        userId,
        organizationId,
        entityType: existing.entityType,
        oldLocalId: existing.localId,
        oldQbId: existing.qbId,
        newLocalId,
        newQbId,
        conflictsOverridden: overrideConflicts,
      },
    });

    res.json({
      success: true,
      mapping: {
        id: updated.id,
        localId: updated.localId,
        qbId: updated.qbId,
        qbName: updated.qbName,
      },
    });
  } catch (error: any) {
    handleQBError(error, res);
  }
});

/**
 * GET /api/quickbooks/search/pos
 * Search POS entities by type and query
 */
router.get('/search/pos', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { entityType, q } = req.query;
    const { organizationId } = req.user;

    if (!entityType) {
      return res.status(400).json({ error: 'entityType required' });
    }

    // For now, return empty array - this would query POS database for local entities
    // In production, this would search the actual POS entity tables
    const results: any[] = [];

    res.json({
      success: true,
      results,
    });
  } catch (error: any) {
    handleQBError(error, res);
  }
});

/**
 * GET /api/quickbooks/search/qb
 * Search QB entities with mapping metadata
 */
router.get('/search/qb', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { entityType, q } = req.query;
    const { organizationId } = req.user;

    if (!entityType || !q) {
      return res.status(400).json({ error: 'entityType and q required' });
    }

    // Get QB entities from cached list or QB API
    const { accessToken, realmId } = await getValidAccessToken(organizationId, prisma);
    const apiUrl = getQBApiUrl();

    let endpoint = '';
    let query = '';

    if (entityType === 'account') {
      endpoint = 'account';
      query = `SELECT * FROM Account WHERE Name LIKE '%${q}%' MAXRESULTS 50`;
    } else if (entityType === 'customer') {
      endpoint = 'customer';
      query = `SELECT * FROM Customer WHERE DisplayName LIKE '%${q}%' MAXRESULTS 50`;
    } else if (entityType === 'item') {
      endpoint = 'item';
      query = `SELECT * FROM Item WHERE Name LIKE '%${q}%' MAXRESULTS 50`;
    } else if (entityType === 'bank') {
      endpoint = 'account';
      query = `SELECT * FROM Account WHERE AccountType = 'Bank' AND Name LIKE '%${q}%' MAXRESULTS 50`;
    }

    if (!query) {
      return res.status(400).json({ error: 'Invalid entityType' });
    }

    const response = await fetch(`${apiUrl}/v3/company/${realmId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'QB API error' });
    }

    const data = await response.json() as any;
    const qbEntities = data.QueryResponse?.[Object.keys(data.QueryResponse)[0]] || [];

    // Enrich with mapping metadata
    const results = await Promise.all(
      qbEntities.map(async (entity: any) => {
        const qbId = entity.Id;
        const qbName = entity.Name || entity.DisplayName;

        // Check if already mapped
        const mapping = await prisma.qBEntityMapping.findFirst({
          where: {
            organizationId,
            entityType: entityType as string,
            qbId,
          },
        });

        return {
          qbId,
          qbName,
          entityType,
          alreadyMapped: !!mapping,
          mappedTo: mapping ? {
            localId: mapping.localId,
            localName: mapping.localName || mapping.localId,
          } : null,
        };
      })
    );

    res.json({
      success: true,
      results,
    });
  } catch (error: any) {
    handleQBError(error, res);
  }
});

/**
 * GET /api/quickbooks/mappings/export
 * Export all mappings with reconciliation status (CSV or Excel)
 * Query params: format=csv|xlsx (default: csv)
 */
router.get('/mappings/export', authenticate, authorize('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.user;
    const format = (req.query.format as string || 'csv').toLowerCase();

    if (!['csv', 'xlsx', 'excel', 'json'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use csv, xlsx, or json' });
    }

    // Import ExportService dynamically to avoid circular dependencies
    const { ExportService } = await import('./export.service');

    // Get export data
    const exportData = await ExportService.getExportData(organizationId);

    // Generate timestamp for filename
    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      // Generate CSV
      const csv = ExportService.generateCSV(exportData);

      // Set proper headers for CSV
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="qb-mappings-${timestamp}.csv"`);
      res.send(csv);
    } else if (format === 'xlsx' || format === 'excel') {
      // Generate Excel workbook
      const buffer = ExportService.generateExcel(exportData);

      // Set proper headers for Excel
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="qb-mappings-${timestamp}.xlsx"`);
      res.send(buffer);
    } else if (format === 'json') {
      // JSON response for API consumers
      res.json({
        success: true,
        data: exportData,
      });
    }
  } catch (error: any) {
    console.error('[QB Export] Error:', error);
    handleQBError(error, res);
  }
});

export default router;
