/**
 * QuickBooks Preflight Validation Service
 *
 * Production readiness checks before enabling QB sync.
 * Validates infrastructure, configuration, and data readiness.
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { OpLog } from './error-classifier';

const prisma = new PrismaClient();

export type CheckStatus = 'pass' | 'warning' | 'fail';
export type OverallStatus = 'ready' | 'warning' | 'blocked';

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

/**
 * Run all preflight checks for an organization
 */
export async function runPreflightChecks(organizationId: string): Promise<PreflightResult> {
  console.log(`[QB Preflight] Starting checks for org ${organizationId}`);

  const checks: PreflightCheck[] = [];

  // 1. Database migration state
  checks.push(await checkDatabaseMigration());

  // 2. Required environment variables
  checks.push(await checkEnvironmentVariables());

  // 3. Active QB connection
  checks.push(await checkQuickBooksConnection(organizationId));

  // 4. Entity mapping readiness
  const mappingChecks = await checkEntityMappings(organizationId);
  checks.push(...mappingChecks);

  // 5. Redis connectivity
  checks.push(await checkRedisConnectivity());

  // Calculate overall status
  const passed = checks.filter(c => c.status === 'pass').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  // Log failures and warnings with stable prefixes for monitoring
  checks.forEach(check => {
    if (check.status === 'fail') {
      console.error(OpLog.preflightFail(check.name, check.message));
    } else if (check.status === 'warning') {
      console.warn(OpLog.preflightWarn(check.name, check.message));
    }
  });

  let overallStatus: OverallStatus;
  if (failed > 0) {
    overallStatus = 'blocked';
  } else if (warnings > 0) {
    overallStatus = 'warning';
  } else {
    overallStatus = 'ready';
  }

  const result: PreflightResult = {
    success: overallStatus !== 'blocked',
    overallStatus,
    checks,
    summary: {
      totalChecks: checks.length,
      passed,
      warnings,
      failed,
      timestamp: new Date().toISOString()
    }
  };

  console.log(`[QB Preflight] Completed: ${overallStatus} (${passed}/${checks.length} passed, ${warnings} warnings, ${failed} failed)`);

  return result;
}

/**
 * Check 1: Database migration state
 * Verify qb_entity_mappings table exists
 */
async function checkDatabaseMigration(): Promise<PreflightCheck> {
  try {
    // Try to query the table to verify it exists
    await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'qb_entity_mappings'
      ) as exists
    `;

    // Additionally verify the table has expected columns
    const result: any = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'qb_entity_mappings'
    `;

    const columns = result.map((r: any) => r.column_name);
    const requiredColumns = ['id', 'organization_id', 'entity_type', 'local_id', 'qb_id'];
    const missingColumns = requiredColumns.filter(col => !columns.includes(col));

    if (missingColumns.length > 0) {
      return {
        name: 'Database Migration',
        status: 'fail',
        message: `qb_entity_mappings table exists but missing columns: ${missingColumns.join(', ')}`,
        details: { missingColumns }
      };
    }

    return {
      name: 'Database Migration',
      status: 'pass',
      message: 'qb_entity_mappings table exists with required schema',
      details: { columns: columns.length }
    };
  } catch (error) {
    return {
      name: 'Database Migration',
      status: 'fail',
      message: `qb_entity_mappings table not found. Run: npx prisma migrate deploy`,
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

/**
 * Check 2: Required environment variables
 * Verify all QB-related env vars are set (without exposing values)
 */
async function checkEnvironmentVariables(): Promise<PreflightCheck> {
  const requiredVars = [
    { name: 'QUICKBOOKS_CLIENT_ID', critical: true },
    { name: 'QUICKBOOKS_CLIENT_SECRET', critical: true },
    { name: 'QUICKBOOKS_REDIRECT_URI', critical: true },
    { name: 'QUICKBOOKS_ENVIRONMENT', critical: true },
    { name: 'QB_TOKEN_ENCRYPTION_KEY', critical: true },
    { name: 'REDIS_URL', critical: true },
    { name: 'DATABASE_URL', critical: true }
  ];

  const missing = requiredVars.filter(v => !process.env[v.name]);
  const criticalMissing = missing.filter(v => v.critical);

  if (criticalMissing.length > 0) {
    return {
      name: 'Environment Variables',
      status: 'fail',
      message: `Missing critical env vars: ${criticalMissing.map(v => v.name).join(', ')}`,
      details: {
        missing: criticalMissing.map(v => v.name),
        configured: requiredVars.length - missing.length,
        total: requiredVars.length
      }
    };
  }

  if (missing.length > 0) {
    return {
      name: 'Environment Variables',
      status: 'warning',
      message: `Missing optional env vars: ${missing.map(v => v.name).join(', ')}`,
      details: {
        missing: missing.map(v => v.name),
        configured: requiredVars.length - missing.length,
        total: requiredVars.length
      }
    };
  }

  // Validate encryption key format (without exposing it)
  try {
    const keyString = process.env.QB_TOKEN_ENCRYPTION_KEY;
    if (!keyString) throw new Error('Missing');

    let key: Buffer;
    try {
      key = Buffer.from(keyString, 'base64');
    } catch {
      key = Buffer.from(keyString, 'hex');
    }

    if (key.length !== 32) {
      return {
        name: 'Environment Variables',
        status: 'fail',
        message: `QB_TOKEN_ENCRYPTION_KEY must be 32 bytes (current: ${key.length} bytes)`,
        details: {
          configured: requiredVars.length,
          total: requiredVars.length,
          encryptionKeyValid: false
        }
      };
    }
  } catch (error) {
    return {
      name: 'Environment Variables',
      status: 'fail',
      message: 'QB_TOKEN_ENCRYPTION_KEY is invalid or not base64/hex encoded',
      details: {
        configured: requiredVars.length,
        total: requiredVars.length,
        encryptionKeyValid: false
      }
    };
  }

  return {
    name: 'Environment Variables',
    status: 'pass',
    message: 'All required environment variables configured',
    details: {
      configured: requiredVars.length,
      total: requiredVars.length,
      encryptionKeyValid: true
    }
  };
}

/**
 * Check 3: Active QuickBooks connection
 * Verify at least one active connection exists for the organization
 */
async function checkQuickBooksConnection(organizationId: string): Promise<PreflightCheck> {
  try {
    const connection = await prisma.qBConnection.findFirst({
      where: {
        organizationId,
        isActive: true
      },
      select: {
        id: true,
        companyName: true,
        realmId: true,
        syncMode: true,
        globalKillSwitch: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
        lastSyncAt: true,
        lastSyncStatus: true
      }
    });

    if (!connection) {
      return {
        name: 'QuickBooks Connection',
        status: 'fail',
        message: 'No active QuickBooks connection found. Complete OAuth connection first.',
        details: { connected: false }
      };
    }

    // Check token expiry
    const now = new Date();
    const accessExpired = connection.accessTokenExpiresAt && connection.accessTokenExpiresAt < now;
    const refreshExpired = connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt < now;

    if (refreshExpired) {
      return {
        name: 'QuickBooks Connection',
        status: 'fail',
        message: 'QuickBooks connection exists but refresh token expired. Reconnect required.',
        details: {
          connected: true,
          companyName: connection.companyName,
          tokenExpired: true,
          refreshTokenExpired: true
        }
      };
    }

    if (accessExpired) {
      return {
        name: 'QuickBooks Connection',
        status: 'warning',
        message: 'QuickBooks connected but access token expired (will auto-refresh on next sync)',
        details: {
          connected: true,
          companyName: connection.companyName,
          syncMode: connection.syncMode,
          killSwitchActive: connection.globalKillSwitch,
          accessTokenExpired: true
        }
      };
    }

    if (connection.globalKillSwitch) {
      return {
        name: 'QuickBooks Connection',
        status: 'fail',
        message: 'QuickBooks connected but KILL SWITCH is active. Deactivate to proceed.',
        details: {
          connected: true,
          companyName: connection.companyName,
          killSwitchActive: true
        }
      };
    }

    return {
      name: 'QuickBooks Connection',
      status: 'pass',
      message: `Connected to ${connection.companyName}`,
      details: {
        connected: true,
        companyName: connection.companyName,
        syncMode: connection.syncMode,
        killSwitchActive: false,
        lastSyncAt: connection.lastSyncAt,
        lastSyncStatus: connection.lastSyncStatus
      }
    };
  } catch (error) {
    return {
      name: 'QuickBooks Connection',
      status: 'fail',
      message: 'Failed to check QuickBooks connection status',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

/**
 * Check 4: Entity mapping readiness
 * Verify required mappings exist (walk-in customer, payment methods, fuel items)
 */
async function checkEntityMappings(organizationId: string): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];

  try {
    // Check 4a: Walk-in customer mapping
    const walkInMapping = await prisma.qBEntityMapping.findFirst({
      where: {
        organizationId,
        entityType: 'customer',
        localId: 'walk-in',
        isActive: true
      }
    });

    if (!walkInMapping) {
      checks.push({
        name: 'Walk-In Customer Mapping',
        status: 'fail',
        message: 'Walk-in customer mapping not found. Create mapping: localId=walk-in, entityType=customer',
        details: { exists: false }
      });
    } else {
      checks.push({
        name: 'Walk-In Customer Mapping',
        status: 'pass',
        message: `Walk-in customer mapped to QB ID: ${walkInMapping.qbId}`,
        details: { exists: true, qbId: walkInMapping.qbId, qbName: walkInMapping.qbName }
      });
    }

    // Check 4b: Payment method mappings
    const expectedPaymentMethods = ['cash', 'card'];
    const paymentMethodMappings = await prisma.qBEntityMapping.findMany({
      where: {
        organizationId,
        entityType: 'payment_method',
        localId: { in: expectedPaymentMethods },
        isActive: true
      }
    });

    const mappedMethods = paymentMethodMappings.map(m => m.localId);
    const missingMethods = expectedPaymentMethods.filter(m => !mappedMethods.includes(m));

    if (missingMethods.length > 0) {
      checks.push({
        name: 'Payment Method Mappings',
        status: 'fail',
        message: `Missing payment method mappings: ${missingMethods.join(', ')}. Create via /api/quickbooks/mappings`,
        details: {
          required: expectedPaymentMethods,
          mapped: mappedMethods,
          missing: missingMethods
        }
      });
    } else {
      checks.push({
        name: 'Payment Method Mappings',
        status: 'pass',
        message: `All required payment methods mapped (${mappedMethods.length})`,
        details: {
          required: expectedPaymentMethods,
          mapped: mappedMethods
        }
      });
    }

    // Check 4c: Fuel item mappings
    // Query fuel types from DB to determine what needs mapping
    const fuelTypes = await prisma.fuelType.findMany({
      select: { id: true, code: true, name: true }
    });

    if (fuelTypes.length === 0) {
      checks.push({
        name: 'Fuel Item Mappings',
        status: 'warning',
        message: 'No fuel types defined in system. Define fuel types to enable item mapping checks.',
        details: { fuelTypesCount: 0 }
      });
    } else {
      const fuelTypeIds = fuelTypes.map(ft => ft.id);
      const fuelItemMappings = await prisma.qBEntityMapping.findMany({
        where: {
          organizationId,
          entityType: 'item',
          localId: { in: fuelTypeIds },
          isActive: true
        }
      });

      const mappedFuelTypes = fuelItemMappings.map(m => m.localId);
      const unmappedFuelTypes = fuelTypes.filter(ft => !mappedFuelTypes.includes(ft.id));

      if (unmappedFuelTypes.length > 0) {
        checks.push({
          name: 'Fuel Item Mappings',
          status: 'fail',
          message: `Missing fuel item mappings: ${unmappedFuelTypes.map(ft => ft.name).join(', ')}`,
          details: {
            totalFuelTypes: fuelTypes.length,
            mapped: mappedFuelTypes.length,
            unmapped: unmappedFuelTypes.map(ft => ({ id: ft.id, code: ft.code, name: ft.name }))
          }
        });
      } else {
        checks.push({
          name: 'Fuel Item Mappings',
          status: 'pass',
          message: `All fuel types mapped to QB items (${mappedFuelTypes.length}/${fuelTypes.length})`,
          details: {
            totalFuelTypes: fuelTypes.length,
            mapped: mappedFuelTypes.length
          }
        });
      }
    }
  } catch (error) {
    checks.push({
      name: 'Entity Mappings',
      status: 'fail',
      message: 'Failed to check entity mappings',
      details: { error: error instanceof Error ? error.message : String(error) }
    });
  }

  return checks;
}

/**
 * Check 5: Redis connectivity
 * Verify Redis connection for queue processor locks
 */
async function checkRedisConnectivity(): Promise<PreflightCheck> {
  let redisClient: ReturnType<typeof createClient> | null = null;

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return {
        name: 'Redis Connectivity',
        status: 'fail',
        message: 'REDIS_URL not configured',
        details: { configured: false }
      };
    }

    redisClient = createClient({ url: redisUrl });

    // Set timeout for connection attempt
    const connectPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout (5s)')), 5000)
    );

    await Promise.race([connectPromise, timeoutPromise]);

    // Test ping
    const pong = await redisClient.ping();

    if (pong !== 'PONG') {
      await redisClient.quit();
      return {
        name: 'Redis Connectivity',
        status: 'fail',
        message: 'Redis ping failed',
        details: { connected: true, pingResponse: pong }
      };
    }

    await redisClient.quit();

    return {
      name: 'Redis Connectivity',
      status: 'pass',
      message: 'Redis connected and responsive',
      details: { connected: true, pingSuccess: true }
    };
  } catch (error) {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      name: 'Redis Connectivity',
      status: 'fail',
      message: 'Cannot connect to Redis. Verify REDIS_URL and Redis server is running.',
      details: {
        connected: false,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
