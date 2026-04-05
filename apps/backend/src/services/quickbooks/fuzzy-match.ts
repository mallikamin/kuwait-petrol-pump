/**
 * Multi-signal fuzzy matching engine for QB entity matching.
 * Ported from Restaurant POS with petrol pump-specific enhancements.
 */

// Synonym sets - petrol pump specific terms
const SYNONYM_SETS: Set<string>[] = [
  // 0 - Fuel / petroleum
  new Set(['fuel', 'petrol', 'gasoline', 'gas', 'diesel', 'hsd', 'pmg', 'petroleum']),
  // 1 - Revenue
  new Set(['sales', 'revenue', 'income', 'earnings', 'proceeds', 'turnover']),
  // 2 - Meter / dispenser
  new Set(['meter', 'nozzle', 'pump', 'dispenser', 'reading']),
  // 3 - Shortage / variance
  new Set(['shortage', 'overage', 'variance', 'difference', 'loss', 'gain', 'discrepancy']),
  // 4 - Inventory
  new Set(['inventory', 'stock', 'supplies', 'goods', 'assets']),
  // 5 - Cost / COGS
  new Set(['cost', 'cogs', 'purchase', 'procurement', 'expense']),
  // 6 - Customer types
  new Set(['customer', 'client', 'account', 'walk-in', 'credit']),
  // 7 - Payment terms
  new Set(['receivable', 'payable', 'outstanding', 'due', 'credit']),
  // 8 - Cash
  new Set(['cash', 'register', 'drawer', 'till', 'petty cash']),
  // 9 - Bank / card
  new Set(['bank', 'checking', 'savings', 'current account', 'settlement', 'card']),
  // 10 - Pakistani banks
  new Set(['hbl', 'ubl', 'mcb', 'abl', 'allied', 'nbp', 'meezan', 'nbk', 'gulf bank', 'faysal']),
  // 11 - Mobile wallets
  new Set(['jazzcash', 'easypaisa', 'mobile wallet', 'digital payment']),
  // 12 - Shop items
  new Set(['shop', 'store', 'retail', 'non-fuel', 'merchandise', 'accessories']),
  // 13 - Tax
  new Set(['tax', 'gst', 'sst', 'vat', 'duty', 'withholding', 'sales tax']),
  // 14 - Deposit / advance
  new Set(['deposit', 'advance', 'prepaid', 'settlement']),
];

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

// Simple fuzzy matching implementation
export function findBestMatches(
  templateName: string,
  templateType: string,
  qbEntities: Array<{ id: string; name: string; type: string; subType?: string }>,
  expectedTypes: string[],
  expectedSubType?: string,
  maxCandidates: number = 5,
  minScore: number = 0.15,
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const tempLower = templateName.toLowerCase();

  for (const entity of qbEntities) {
    const entityLower = entity.name.toLowerCase();
    let score = 0;

    // Exact match
    if (tempLower === entityLower) score = 1.0;
    // Contains
    else if (entityLower.includes(tempLower) || tempLower.includes(entityLower)) score = 0.7;
    // Type match bonus
    if (expectedTypes.includes(entity.type)) score += 0.2;

    if (score >= minScore) {
      candidates.push({
        qbEntityId: entity.id,
        qbEntityName: entity.name,
        qbEntityType: entity.type,
        qbEntitySubType: entity.subType,
        score,
        matchReason: score >= THRESHOLD_HIGH ? 'High confidence' : score >= THRESHOLD_MEDIUM ? 'Medium confidence' : 'Low confidence',
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxCandidates);
}
