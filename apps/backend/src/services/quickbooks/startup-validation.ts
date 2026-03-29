/**
 * QuickBooks Startup Validation (P0)
 * - Fail fast if required env vars missing in production
 * - Ensures app isolation (Kuwait-specific QB app)
 */

export function validateQuickBooksConfig() {
  const env = process.env.NODE_ENV || 'development';
  const qbEnv = process.env.QUICKBOOKS_ENVIRONMENT;

  // Skip validation in development/test
  if (env === 'development' || env === 'test') {
    console.log('[QB] Skipping startup validation in', env);
    return;
  }

  const required = [
    'QUICKBOOKS_CLIENT_ID',
    'QUICKBOOKS_CLIENT_SECRET',
    'QUICKBOOKS_REDIRECT_URI',
    'QUICKBOOKS_ENVIRONMENT',
    'QB_TOKEN_ENCRYPTION_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('[QB] FATAL: Missing required QuickBooks environment variables:', missing);
    console.error('[QB] Kuwait POS requires dedicated QuickBooks app credentials');
    console.error('[QB] See QUICKBOOKS_OAUTH_COMPLETE.md for setup instructions');
    process.exit(1);
  }

  // Validate production isolation
  if (qbEnv === 'production') {
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || '';
    if (!redirectUri.includes('kuwaitpos')) {
      console.error('[QB] FATAL: Production QUICKBOOKS_REDIRECT_URI must point to Kuwait POS domain');
      console.error('[QB] Current:', redirectUri);
      console.error('[QB] Expected: https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback');
      process.exit(1);
    }

    console.log('[QB] ✅ Startup validation passed (production mode, Kuwait-isolated app)');
    console.log('[QB] Redirect URI:', redirectUri);
  } else {
    console.log('[QB] ✅ Startup validation passed (sandbox mode)');
  }
}
