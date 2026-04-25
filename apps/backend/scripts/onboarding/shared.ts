// Shared helpers for the onboarding CLI scripts. Kept tiny on purpose:
// these scripts run rarely, by humans, and clarity beats abstraction.

export interface ParsedArgs {
  [key: string]: string | undefined;
}

/// Parse `--key value --flag` style arguments. Unknown keys are accepted
/// (the caller validates required ones). Boolean flags become "true".
export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const CODE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/// Validates and lowercases a tenant/branch code. Codes are lowercase
/// alphanumeric with hyphens, must start with a letter, max 32 chars —
/// safe for use in usernames and URLs.
export function normalizeCode(input: string, label: string): string {
  const code = input.trim().toLowerCase();
  if (!CODE_PATTERN.test(code)) {
    throw new Error(
      `Invalid ${label} code "${input}": must match ${CODE_PATTERN} ` +
        `(lowercase letter first, then letters/digits/hyphens, max 32 chars).`,
    );
  }
  return code;
}

const ALLOWED_ROLES = ['admin', 'manager', 'accountant', 'cashier', 'operator'] as const;
type Role = (typeof ALLOWED_ROLES)[number];

export function normalizeRole(input: string): Role {
  const role = input.trim().toLowerCase();
  if (!ALLOWED_ROLES.includes(role as Role)) {
    throw new Error(
      `Invalid role "${input}": must be one of ${ALLOWED_ROLES.join(', ')}.`,
    );
  }
  return role as Role;
}

/// Lowercases a username. Storage convention is lowercase so onboarding
/// stays consistent regardless of how the operator typed it. Login is
/// already case-insensitive (auth.service.ts), so existing mixed-case
/// users keep working.
export function normalizeUsername(input: string): string {
  const u = input.trim().toLowerCase();
  if (!u) {
    throw new Error('Username is required.');
  }
  if (u.length > 100) {
    throw new Error(`Username "${input}" exceeds 100 characters.`);
  }
  return u;
}

export function requireArg(args: ParsedArgs, key: string, scriptName: string): string {
  const value = args[key];
  if (!value || value === 'true') {
    throw new Error(
      `Missing required --${key}. See: tsx scripts/onboarding/${scriptName}.ts --help`,
    );
  }
  return value;
}
