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

  // Validate production isolation: redirect URI host must be in allowlist
  if (qbEnv === 'production') {
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || '';

    // Env-driven allowlist; defaults to current production host so existing deploys are unaffected
    const allowedHostsRaw = process.env.QB_REDIRECT_URI_ALLOWED_HOSTS || 'kuwaitpos.duckdns.org';
    const allowedHosts = allowedHostsRaw.split(',').map((h) => h.trim()).filter(Boolean);

    let redirectHost = '';
    try {
      redirectHost = new URL(redirectUri).host;
    } catch {
      console.error('[QB] FATAL: Invalid QUICKBOOKS_REDIRECT_URI:', redirectUri);
      process.exit(1);
    }

    if (!allowedHosts.includes(redirectHost)) {
      console.error('[QB] FATAL: QUICKBOOKS_REDIRECT_URI host not in allowlist');
      console.error('[QB] Current host:', redirectHost);
      console.error('[QB] Allowed hosts:', allowedHosts);
      console.error('[QB] Set QB_REDIRECT_URI_ALLOWED_HOSTS env var to authorize a new host');
      process.exit(1);
    }

    console.log('[QB] ✅ Startup validation passed (production mode, host-isolated)');
    console.log('[QB] Redirect URI:', redirectUri);
    console.log('[QB] Allowed hosts:', allowedHosts);
  } else {
    console.log('[QB] ✅ Startup validation passed (sandbox mode)');
  }
}
