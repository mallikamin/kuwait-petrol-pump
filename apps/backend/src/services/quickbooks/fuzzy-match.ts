/**
 * Multi-signal fuzzy matching engine for QB entity matching.
 * Ported from Restaurant POS with petrol pump-specific enhancements.
 *
 * Reference: C:\Users\Malik\.claude\projects\...\RESTAURANT_POS_QB_REFERENCE.md
 */

// ============================================================
// SYNONYM SETS - Petrol Pump Specific
// ============================================================

const SYNONYM_SETS: Set<string>[] = [
  // 0 - Fuel / petroleum
  new Set(['fuel', 'petrol', 'gasoline', 'gas', 'diesel', 'hsd', 'pmg', 'petroleum', 'octane']),
  // 1 - Revenue / income
  new Set(['sales', 'revenue', 'income', 'earnings', 'proceeds', 'turnover', 'amdani']),
  // 2 - Meter / dispenser
  new Set(['meter', 'nozzle', 'pump', 'dispenser', 'reading', 'gauge']),
  // 3 - Shortage / variance
  new Set(['shortage', 'overage', 'variance', 'difference', 'loss', 'gain', 'discrepancy', 'shrinkage']),
  // 4 - Inventory
  new Set(['inventory', 'stock', 'supplies', 'goods', 'assets', 'on hand']),
  // 5 - Cost / COGS
  new Set(['cost', 'cogs', 'purchase', 'procurement', 'expense', 'kharcha']),
  // 6 - Customer types
  new Set(['customer', 'client', 'account', 'walk-in', 'credit', 'trade']),
  // 7 - Payment terms
  new Set(['receivable', 'payable', 'outstanding', 'due', 'credit', 'ar', 'ap']),
  // 8 - Cash
  new Set(['cash', 'register', 'drawer', 'till', 'petty cash', 'naqd', 'currency']),
  // 9 - Bank / card
  new Set(['bank', 'checking', 'savings', 'current account', 'settlement', 'card', 'debit', 'credit card']),
  // 10 - Pakistani banks
  new Set(['hbl', 'ubl', 'mcb', 'abl', 'allied', 'nbp', 'meezan', 'nbk', 'national bank kuwait', 'gulf bank', 'faysal', 'js', 'standard chartered']),
  // 11 - Mobile wallets
  new Set(['jazzcash', 'easypaisa', 'mobile wallet', 'digital payment', 'jazz', 'telenor']),
  // 12 - Shop items
  new Set(['shop', 'store', 'retail', 'non-fuel', 'merchandise', 'accessories', 'convenience']),
  // 13 - Tax
  new Set(['tax', 'gst', 'sst', 'vat', 'duty', 'withholding', 'sales tax', 'fbr', 'federal']),
  // 14 - Deposit / advance
  new Set(['deposit', 'advance', 'prepaid', 'settlement', 'down payment']),
  // 15 - Utility
  new Set(['utility', 'electricity', 'water', 'phone', 'internet', 'bijli', 'pani', 'gas bill']),
  // 16 - Rent
  new Set(['rent', 'lease', 'rental', 'kiraya', 'premises']),
  // 17 - Salary / wages
  new Set(['salary', 'wage', 'payroll', 'compensation', 'tankhwah', 'muavza']),
  // 18 - Pakistani accounting terms
  new Set(['khana', 'kharch', 'amdani', 'naqd', 'kiraya', 'bijli', 'tankhwah']),
];

// ============================================================
// ACCOUNTING STOP WORDS (for anchor extraction)
// ============================================================

const ACCT_STOP_WORDS = new Set([
  'expense', 'cost', 'sales', 'revenue', 'income', 'payable', 'receivable',
  'account', 'fee', 'charges', 'paid', 'unpaid', 'current', 'assets', 'liability',
  'liabilities', 'equity', 'other', 'general', 'miscellaneous', 'misc',
]);

// ============================================================
// TYPES & INTERFACES
// ============================================================

export interface MatchCandidate {
  qbEntityId: string;
  qbEntityName: string;
  qbEntityType: string;
  qbEntitySubType?: string;
  score: number;
  matchReason: string;
}

export const THRESHOLD_HIGH = 0.85;
export const THRESHOLD_MEDIUM = 0.60;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Normalize text for matching (lowercase, trim, normalize spaces)
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/);
}

/**
 * Extract anchor tokens (distinctive words) from accounting text
 */
function extractAnchors(text: string): string[] {
  const tokens = tokenize(text);
  return tokens.filter((t) => !ACCT_STOP_WORDS.has(t) && t.length > 2);
}

/**
 * Find which synonym set a word belongs to (if any)
 */
function getSynonymSet(word: string): Set<string> | null {
  word = normalize(word);
  for (const synSet of SYNONYM_SETS) {
    if (synSet.has(word)) return synSet;
  }
  return null;
}

/**
 * Calculate Jaccard similarity between two token sets
 */
function jaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Check if text2 is a substring of text1 (or vice versa)
 */
function substringMatch(text1: string, text2: string): boolean {
  const t1 = normalize(text1);
  const t2 = normalize(text2);
  return t1.includes(t2) || t2.includes(t1);
}

/**
 * Count synonym overlaps between two token sets
 */
function countSynonymOverlaps(tokens1: string[], tokens2: string[]): number {
  let overlaps = 0;
  for (const t1 of tokens1) {
    const synSet1 = getSynonymSet(t1);
    if (!synSet1) continue;
    for (const t2 of tokens2) {
      const synSet2 = getSynonymSet(t2);
      if (synSet2 && synSet1 === synSet2) {
        overlaps++;
        break; // Count each t1 synonym match only once
      }
    }
  }
  return overlaps;
}

// ============================================================
// MULTI-SIGNAL MATCHING ENGINE
// ============================================================

/**
 * Find best matching QB entities for a POS need using multi-signal scoring.
 *
 * Scoring weights (from Restaurant POS):
 * - Exact match: 1.0
 * - Anchor match: 0.50
 * - Synonym overlap: 0.25 per synonym
 * - Type compatibility: 0.20
 * - Jaccard similarity: 0.40
 * - Substring match: 0.15
 *
 * Fuel Code Anchor Rules (Heavy Penalty):
 * - PMG needs must match PMG/Premium signals (reject HSD/Diesel)
 * - HSD needs must match HSD/Diesel signals (reject PMG/Premium)
 *
 * @param templateName - POS need name (e.g., "Fuel Sales PMG")
 * @param templateType - Expected QB type (e.g., "Income")
 * @param qbEntities - List of QB entities to match against
 * @param expectedTypes - Acceptable QB types (e.g., ["Income", "Other Income"])
 * @param expectedSubType - Expected QB sub-type (optional)
 * @param maxCandidates - Max number of candidates to return (default 5)
 * @param minScore - Minimum score threshold (default 0.15)
 */
export function findBestMatches(
  templateName: string,
  templateType: string,
  qbEntities: Array<{
    id: string;
    name: string;
    account_type?: string;
    type?: string;
    account_sub_type?: string;
    sub_type?: string;
  }>,
  expectedTypes: string[],
  expectedSubType?: string,
  maxCandidates: number = 5,
  minScore: number = 0.15,
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  const templateLower = normalize(templateName);
  const templateTokens = tokenize(templateName);
  const templateAnchors = extractAnchors(templateName);

  // Fuel code anchor detection
  const templateHasPMG = templateTokens.some(t => ['pmg', 'premium'].includes(t));
  const templateHasHSD = templateTokens.some(t => ['hsd', 'diesel'].includes(t));

  for (const entity of qbEntities) {
    const entityLower = normalize(entity.name);
    const entityTokens = tokenize(entity.name);
    const entityAnchors = extractAnchors(entity.name);
    const entityType = entity.account_type || entity.type || '';
    const entitySubType = entity.account_sub_type || entity.sub_type || '';

    // Fuel code anchor enforcement: Hard reject cross-matches
    const entityHasPMG = entityTokens.some(t => ['pmg', 'premium'].includes(t));
    const entityHasHSD = entityTokens.some(t => ['hsd', 'diesel', 'high', 'speed'].includes(t));

    // Reject if fuel codes don't match
    if (templateHasPMG && entityHasHSD) {
      // Template is PMG but entity is HSD - REJECT
      continue;
    }
    if (templateHasHSD && entityHasPMG) {
      // Template is HSD but entity is PMG - REJECT
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    // Signal 1: Exact match (weight 1.0)
    if (templateLower === entityLower) {
      score += 1.0;
      reasons.push('exact match');
    }

    // Signal 2: Anchor token match (weight 0.50)
    if (templateAnchors.length > 0 && entityAnchors.length > 0) {
      const anchorOverlap = templateAnchors.filter((a) => entityAnchors.includes(a)).length;
      const anchorMax = Math.max(templateAnchors.length, entityAnchors.length);
      const anchorScore = anchorOverlap / anchorMax;
      score += anchorScore * 0.50;
      if (anchorScore > 0) reasons.push(`anchor:${Math.round(anchorScore * 100)}%`);
    }

    // Signal 3: Synonym overlap (weight 0.25 per synonym)
    const synonymOverlaps = countSynonymOverlaps(templateTokens, entityTokens);
    if (synonymOverlaps > 0) {
      score += synonymOverlaps * 0.25;
      reasons.push(`synonyms:${synonymOverlaps}`);
    }

    // Signal 4: Type compatibility (weight 0.20)
    if (expectedTypes.includes(entityType)) {
      score += 0.20;
      reasons.push('type-match');
      // Bonus for sub-type match
      if (expectedSubType && entitySubType === expectedSubType) {
        score += 0.10;
        reasons.push('subtype-match');
      }
    }

    // Signal 5: Jaccard similarity (weight 0.40)
    const jaccard = jaccardSimilarity(templateTokens, entityTokens);
    if (jaccard > 0) {
      score += jaccard * 0.40;
      reasons.push(`jaccard:${Math.round(jaccard * 100)}%`);
    }

    // Signal 6: Substring match (weight 0.15)
    if (substringMatch(templateName, entity.name)) {
      score += 0.15;
      reasons.push('substring');
    }

    // Signal 7: Fuel code anchor bonus (weight 0.30)
    // Reward exact fuel code matches to prioritize them
    if (templateHasPMG && entityHasPMG) {
      score += 0.30;
      reasons.push('pmg-match');
    }
    if (templateHasHSD && entityHasHSD) {
      score += 0.30;
      reasons.push('hsd-match');
    }

    // Only include if above threshold
    if (score >= minScore) {
      let confidence: string;
      if (score >= THRESHOLD_HIGH) confidence = 'High';
      else if (score >= THRESHOLD_MEDIUM) confidence = 'Medium';
      else confidence = 'Low';

      candidates.push({
        qbEntityId: entity.id,
        qbEntityName: entity.name,
        qbEntityType: entityType,
        qbEntitySubType: entitySubType,
        score: Math.min(score, 1.0), // Cap at 1.0
        matchReason: `${confidence} confidence (${Math.round(score * 100)}%) - ${reasons.join(', ')}`,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxCandidates);
}

// ============================================================
// MAPPING TYPE SUGGESTION
// ============================================================

/**
 * Suggest a mapping type for an unmapped QB account based on name/type analysis.
 * Used to categorize leftover QB accounts after matching.
 */
export function suggestMappingType(accountName: string, accountType: string): string | null {
  const lower = normalize(accountName);
  const tokens = tokenize(accountName);

  // Check for distinctive keywords
  if (tokens.some((t) => ['fuel', 'petrol', 'diesel', 'pmg', 'hsd'].includes(t))) {
    return accountType.toLowerCase().includes('income') ? 'fuel_income' : 'fuel_cogs';
  }
  if (tokens.some((t) => ['shop', 'store', 'merchandise'].includes(t))) {
    return 'shop_income';
  }
  if (tokens.some((t) => ['cash', 'register', 'drawer'].includes(t))) {
    return 'cash_account';
  }
  if (tokens.some((t) => ['bank', 'checking', 'savings'].includes(t))) {
    return 'bank_account';
  }
  if (tokens.some((t) => ['receivable', 'ar'].includes(t))) {
    return 'accounts_receivable';
  }
  if (tokens.some((t) => ['payable', 'ap'].includes(t))) {
    return 'accounts_payable';
  }
  if (tokens.some((t) => ['tax', 'gst', 'sst', 'sales tax'].includes(t))) {
    return 'tax_liability';
  }
  if (tokens.some((t) => ['shortage', 'overage', 'variance'].includes(t))) {
    return 'variance_account';
  }

  // Fallback based on account type
  if (accountType.toLowerCase().includes('income')) return 'other_income';
  if (accountType.toLowerCase().includes('expense')) return 'other_expense';
  if (accountType.toLowerCase().includes('asset')) return 'other_asset';
  if (accountType.toLowerCase().includes('liability')) return 'other_liability';

  return null;
}
