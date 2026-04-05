/**
 * Auto-Matching Service for QuickBooks Account Setup
 * Fuzzy-matches POS needs against partner's QB Chart of Accounts
 */

import { PrismaClient } from '@prisma/client';
import { QuickBooksEntityFetcher } from './fetch-entities.service';
import {
  FUEL_STATION_NEEDS,
  AccountingNeed,
  getAllNeedsAsDicts,
} from './kuwait-needs';
import {
  findBestMatches,
  suggestMappingType,
  MatchCandidate,
  THRESHOLD_HIGH,
  THRESHOLD_MEDIUM,
} from './fuzzy-match';

const prisma = new PrismaClient();

// Custom error for QB token expiration
export class QBTokenExpiredError extends Error {
  constructor(message: string = 'QuickBooks token expired. Please reconnect.') {
    super(message);
    this.name = 'QBTokenExpiredError';
  }
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
  // Decision fields (filled by admin during review)
  decision: 'use_existing' | 'create_new' | null;
  decisionAccountId: string | null;
  decisionAccountName: string | null;
}

export interface MatchResult {
  id: string;
  createdAt: string;
  isLive: boolean;
  totalNeeds: number;
  totalQBAccounts: number;
  matched: number;
  candidates: number;
  unmatched: number;
  requiredTotal: number;
  requiredMatched: number;
  coveragePct: number;
  healthGrade: string;
  items: MatchItem[];
  unmappedQBAccounts: Array<{
    qbAccountId: string;
    qbAccountName: string;
    qbAccountType: string;
    qbAccountSubType?: string;
    fullyQualifiedName?: string;
    active: boolean;
    suggestedMappingType: string | null;
  }>;
}

// In-memory store for match results (onboarding session only)
const matchStore: Map<string, MatchResult> = new Map();

function buildMatchItem(need: AccountingNeed, candidates: MatchCandidate[]): MatchItem {
  const best = candidates[0] || null;

  let status: 'matched' | 'candidates' | 'unmatched' = 'unmatched';
  if (best && best.score >= THRESHOLD_HIGH) {
    status = 'matched';
  } else if (best && best.score >= THRESHOLD_MEDIUM) {
    status = 'candidates';
  }

  return {
    needKey: need.key,
    needLabel: need.label,
    needDescription: need.description,
    expectedQBTypes: need.expectedQBTypes,
    expectedQBSubType: need.expectedQBSubType,
    required: need.required,
    status,
    bestMatch: best,
    candidates,
    decision: status === 'matched' ? 'use_existing' : null,
    decisionAccountId: status === 'matched' ? best?.qbAccountId || null : null,
    decisionAccountName: status === 'matched' ? best?.qbAccountName || null : null,
  };
}

function computeHealthGrade(matched: number, candidates: number, total: number): string {
  if (total === 0) return 'A';
  const coverage = (matched + candidates) / total;
  if (matched / total >= 1.0) return 'A';
  if (coverage >= 0.9) return 'A';
  if (coverage >= 0.6) return 'B';
  if (coverage >= 0.4) return 'C';
  return 'F';
}

export class AutoMatchService {
  /**
   * Run matching: fetch QB accounts and match against POS needs
   */
  static async runMatching(organizationId: string): Promise<MatchResult> {
    try {
      // 1. Fetch QB entities
      const snapshot = await QuickBooksEntityFetcher.fetchAllEntities(organizationId);
      const qbAccounts = snapshot.accounts;

    // 2. Match each POS need against QB accounts
    const items: MatchItem[] = [];
    const matchedAccountIds: Set<string> = new Set();
    let matchedCount = 0;
    let candidateCount = 0;
    let unmatchedCount = 0;

    for (const need of FUEL_STATION_NEEDS) {
      // Try matching with need label
      let candidates = findBestMatches(
        need.label,
        need.expectedQBTypes[0] || 'Income',
        qbAccounts.map((a) => ({
          id: a.Id,
          name: a.Name,
          account_type: a.AccountType,
          account_sub_type: a.AccountSubType,
        })),
        need.expectedQBTypes,
        need.expectedQBSubType,
        5,
        0.15
      );

      // Also try each search hint
      for (const hint of need.searchHints) {
        const hintCandidates = findBestMatches(
          hint,
          need.expectedQBTypes[0] || 'Income',
          qbAccounts.map((a) => ({
            id: a.Id,
            name: a.Name,
            account_type: a.AccountType,
            account_sub_type: a.AccountSubType,
          })),
          need.expectedQBTypes,
          need.expectedQBSubType,
          3,
          0.15
        );

        // Merge candidates (keep best score per account)
        const existingIds = new Set(candidates.map((c) => c.qbAccountId));
        for (const hc of hintCandidates) {
          if (!existingIds.has(hc.qbAccountId)) {
            candidates.push(hc);
            existingIds.add(hc.qbAccountId);
          } else {
            // Update if better score
            const idx = candidates.findIndex((c) => c.qbAccountId === hc.qbAccountId);
            if (idx >= 0 && hc.score > candidates[idx].score) {
              candidates[idx] = hc;
            }
          }
        }
      }

      // Sort and keep top 5
      candidates.sort((a, b) => b.score - a.score);
      candidates = candidates.slice(0, 5);

      const item = buildMatchItem(need, candidates);
      items.push(item);

      if (item.status === 'matched' && item.bestMatch) {
        matchedAccountIds.add(item.bestMatch.qbAccountId);
        matchedCount++;
      } else if (item.status === 'candidates') {
        candidateCount++;
      } else {
        unmatchedCount++;
      }
    }

    // 3. Find unmapped QB accounts
    const unmappedQB: MatchResult['unmappedQBAccounts'] = [];
    for (const acct of qbAccounts) {
      if (!matchedAccountIds.has(acct.Id)) {
        unmappedQB.push({
          qbAccountId: acct.Id,
          qbAccountName: acct.Name,
          qbAccountType: acct.AccountType,
          qbAccountSubType: acct.AccountSubType,
          fullyQualifiedName: acct.Name, // QB doesn't always return FullyQualifiedName in query
          active: acct.Active,
          suggestedMappingType: suggestMappingType(acct.Name, acct.AccountType),
        });
      }
    }

    const total = FUEL_STATION_NEEDS.length;
    const requiredTotal = FUEL_STATION_NEEDS.filter((n) => n.required).length;
    const requiredMatched = items.filter(
      (item) => item.required && item.status === 'matched'
    ).length;
    const healthGrade = computeHealthGrade(matchedCount, candidateCount, total);

      // 4. Build result
      const resultId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result: MatchResult = {
        id: resultId,
        createdAt: new Date().toISOString(),
        isLive: true,
        totalNeeds: total,
        totalQBAccounts: qbAccounts.length,
        matched: matchedCount,
        candidates: candidateCount,
        unmatched: unmatchedCount,
        requiredTotal,
        requiredMatched,
        coveragePct: total > 0 ? Math.round((matchedCount / total) * 100) : 0,
        healthGrade,
        items,
        unmappedQBAccounts: unmappedQB,
      };

      matchStore.set(resultId, result);
      return result;
    } catch (error: any) {
      // Check if error is from QB API unauthorized response
      if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.message?.includes('expired')) {
        throw new QBTokenExpiredError();
      }
      throw error;
    }
  }

  /**
   * Get stored match result
   */
  static getResult(resultId: string): MatchResult | null {
    return matchStore.get(resultId) || null;
  }

  /**
   * List all match results (summary)
   */
  static listResults(): Array<{
    id: string;
    createdAt: string;
    healthGrade: string;
    matched: number;
    candidates: number;
    unmatched: number;
    totalNeeds: number;
    coveragePct: number;
  }> {
    return Array.from(matchStore.values())
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        healthGrade: r.healthGrade,
        matched: r.matched,
        candidates: r.candidates,
        unmatched: r.unmatched,
        totalNeeds: r.totalNeeds,
        coveragePct: r.coveragePct,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Update admin decisions
   */
  static updateDecisions(
    resultId: string,
    decisions: Array<{
      needKey: string;
      decision: 'use_existing' | 'create_new';
      accountId?: string;
      accountName?: string;
    }>
  ): MatchResult {
    const result = matchStore.get(resultId);
    if (!result) {
      throw new Error(`Match result ${resultId} not found`);
    }

    // Update items with decisions
    for (const dec of decisions) {
      const item = result.items.find((i) => i.needKey === dec.needKey);
      if (item) {
        item.decision = dec.decision;
        item.decisionAccountId = dec.accountId || null;
        item.decisionAccountName = dec.accountName || null;
      }
    }

    matchStore.set(resultId, result);
    return result;
  }

  /**
   * Apply decisions: create QB entities and mappings
   */
  static async applyDecisions(
    resultId: string,
    organizationId: string
  ): Promise<{
    success: boolean;
    mappingsCreated: number;
    qbAccountsCreated: number;
    errors: string[];
  }> {
    const result = matchStore.get(resultId);
    if (!result) {
      throw new Error(`Match result ${resultId} not found`);
    }

    let mappingsCreated = 0;
    let qbAccountsCreated = 0;
    const errors: string[] = [];

    // Get QB connection
    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!connection) {
      throw new Error('No active QuickBooks connection');
    }

    // Process each decision
    for (const item of result.items) {
      if (!item.decision) continue;

      try {
        if (item.decision === 'use_existing' && item.decisionAccountId) {
          // Create mapping to existing QB account
          await prisma.qBEntityMapping.upsert({
            where: {
              uq_qb_mapping_org_type_local: {
                organizationId,
                entityType: 'account',
                localId: item.needKey, // Use need key as pseudo entity ID
              },
            },
            create: {
              organizationId,
              entityType: 'account',
              localId: item.needKey,
              qbId: item.decisionAccountId,
              qbName: item.decisionAccountName || '',
            },
            update: {
              qbId: item.decisionAccountId,
              qbName: item.decisionAccountName || '',
            },
          });
          mappingsCreated++;
        } else if (item.decision === 'create_new') {
          // TODO: Create new QB account via API
          // For now, skip (requires QB API call)
          errors.push(`Auto-create for ${item.needLabel} not yet implemented`);
        }
      } catch (err) {
        errors.push(`Failed to map ${item.needLabel}: ${(err as Error).message}`);
      }
    }

    return {
      success: errors.length === 0,
      mappingsCreated,
      qbAccountsCreated,
      errors,
    };
  }
}
