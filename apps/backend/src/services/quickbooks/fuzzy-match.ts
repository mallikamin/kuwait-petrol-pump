/**
 * Fuzzy Matching Engine for QuickBooks Accounts
 * Scores QB accounts against POS needs using multiple strategies
 */

export const THRESHOLD_HIGH = 0.90;
export const THRESHOLD_MEDIUM = 0.70;
export const THRESHOLD_LOW = 0.50;

export interface MatchCandidate {
  qbAccountId: string;
  qbAccountName: string;
  qbAccountType: string;
  qbAccountSubType?: string;
  score: number;
  matchReason: string;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-1) using Levenshtein distance
 */
function stringSimilarity(a: string, b: string): number {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

/**
 * Score a QB account against a search term
 */
function scoreMatch(
  searchTerm: string,
  qbName: string,
  qbType: string,
  expectedTypes: string[],
  qbSubType?: string,
  expectedSubType?: string
): number {
  let score = 0;

  // Normalize strings
  const searchLower = searchTerm.toLowerCase().trim();
  const qbNameLower = qbName.toLowerCase().trim();

  // 1. Exact match = 100%
  if (searchLower === qbNameLower) {
    return 1.0;
  }

  // 2. Name similarity (40% weight)
  const similarity = stringSimilarity(searchLower, qbNameLower);
  score += similarity * 0.4;

  // 3. Contains match (30% weight)
  if (qbNameLower.includes(searchLower)) {
    score += 0.3;
  } else if (searchLower.includes(qbNameLower)) {
    score += 0.25;
  }

  // 4. Word overlap (20% weight)
  const searchWords = searchLower.split(/\s+/);
  const qbWords = qbNameLower.split(/\s+/);
  const overlappingWords = searchWords.filter((w) => qbWords.includes(w));
  const wordOverlapRatio = overlappingWords.length / Math.max(searchWords.length, qbWords.length);
  score += wordOverlapRatio * 0.2;

  // 5. Type match (10% weight)
  const typeMatch = expectedTypes.some(
    (t) => t.toLowerCase() === qbType.toLowerCase()
  );
  if (typeMatch) {
    score += 0.1;
  }

  // 6. SubType match bonus (+5%)
  if (expectedSubType && qbSubType) {
    if (expectedSubType.toLowerCase() === qbSubType.toLowerCase()) {
      score += 0.05;
    }
  }

  return Math.min(score, 1.0);
}

/**
 * Find best matching QB accounts for a given search term
 */
export function findBestMatches(
  searchTerm: string,
  searchType: string,
  qbAccounts: Array<{
    id: string;
    name: string;
    account_type: string;
    account_sub_type?: string;
  }>,
  expectedTypes: string[],
  expectedSubType?: string,
  maxCandidates: number = 5,
  minScore: number = 0.15
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  for (const acct of qbAccounts) {
    const score = scoreMatch(
      searchTerm,
      acct.name,
      acct.account_type,
      expectedTypes,
      acct.account_sub_type,
      expectedSubType
    );

    if (score >= minScore) {
      candidates.push({
        qbAccountId: acct.id,
        qbAccountName: acct.name,
        qbAccountType: acct.account_type,
        qbAccountSubType: acct.account_sub_type,
        score,
        matchReason: score >= THRESHOLD_HIGH
          ? 'High confidence match'
          : score >= THRESHOLD_MEDIUM
          ? 'Medium confidence match'
          : 'Low confidence match',
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, maxCandidates);
}

/**
 * Suggest mapping type for unmapped QB accounts
 */
export function suggestMappingType(qbName: string, qbType: string): string | null {
  const nameLower = qbName.toLowerCase();
  const typeLower = qbType.toLowerCase();

  // Income patterns
  if (typeLower.includes('income')) {
    if (nameLower.includes('pmg') || nameLower.includes('premium')) return 'fuel_income_pmg';
    if (nameLower.includes('hsd') || nameLower.includes('diesel')) return 'fuel_income_hsd';
    if (nameLower.includes('retail') || nameLower.includes('shop')) return 'nonfuel_income';
  }

  // Bank/Cash patterns
  if (typeLower.includes('bank')) {
    if (nameLower.includes('cash')) return 'cash';
    if (nameLower.includes('card') || nameLower.includes('credit')) return 'bank_card_settlement';
    if (nameLower.includes('pso')) return 'pso_card_settlement';
  }

  // AR/AP patterns
  if (typeLower.includes('receivable')) return 'credit_customer_receivable';
  if (typeLower.includes('payable')) return 'ap_vendor_control';

  // Inventory
  if (nameLower.includes('inventory') || nameLower.includes('stock')) return 'inventory_asset';

  // COGS
  if (typeLower.includes('cost of goods')) return 'cogs_fuel';

  return null;
}
