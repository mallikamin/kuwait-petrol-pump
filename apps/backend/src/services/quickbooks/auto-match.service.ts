/**
 * Auto-Matching Service for QuickBooks Entity Setup
 * Matches ALL entity types: Accounts, Customers, Items, Banks
 */

import { PrismaClient } from '@prisma/client';
import { QuickBooksEntityFetcher } from './fetch-entities.service';
import { EntityMappingService } from './entity-mapping.service';
import { MappingBatchService } from './mapping-batch.service';
import {
  FUEL_STATION_NEEDS,
  AccountingNeed,
} from './kuwait-needs';
import {
  findBestMatches,
  suggestMappingType,
  MatchCandidate,
  THRESHOLD_HIGH,
  THRESHOLD_MEDIUM,
} from './fuzzy-match';
import { getValidAccessToken, getQBApiUrl } from './token-refresh';
import { QBTokenExpiredError, QBTransientError } from './errors';

const prisma = new PrismaClient();

// ============================================================
// TYPES & INTERFACES
// ============================================================

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

  // Overall coverage
  overallHealthGrade: string;
  overallCoveragePct: number;
}

// In-memory store for match results (onboarding session only)
const matchStore: Map<string, MatchResult> = new Map();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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
    decisionAccountId: status === 'matched' ? best?.qbEntityId || null : null,
    decisionAccountName: status === 'matched' ? best?.qbEntityName || null : null,
  };
}

function buildEntityMatchItem(
  localId: string,
  localName: string,
  entityType: 'customer' | 'item' | 'bank',
  candidates: MatchCandidate[]
): EntityMatchItem {
  const best = candidates[0] || null;

  let status: 'matched' | 'candidates' | 'unmatched' = 'unmatched';
  if (best && best.score >= THRESHOLD_HIGH) {
    status = 'matched';
  } else if (best && best.score >= THRESHOLD_MEDIUM) {
    status = 'candidates';
  }

  return {
    localId,
    localName,
    entityType,
    status,
    bestMatch: best,
    candidates,
    decision: status === 'matched' ? 'use_existing' : null,
    decisionEntityId: status === 'matched' ? best?.qbEntityId || null : null,
    decisionEntityName: status === 'matched' ? best?.qbEntityName || null : null,
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

// ============================================================
// AUTO-MATCH SERVICE
// ============================================================

export class AutoMatchService {
  /**
   * Run matching for ALL entity types: Accounts, Customers, Items, Banks
   */
  static async runMatching(organizationId: string): Promise<MatchResult> {
    try {
      // 1. Fetch QB entities
      const snapshot = await QuickBooksEntityFetcher.fetchAllEntities(organizationId);

      // 2. Fetch local entities and existing mappings
      const [customers, fuelTypes, products, banks, existingMappings] = await Promise.all([
        prisma.customer.findMany({ where: { organizationId }, select: { id: true, name: true } }),
        prisma.fuelType.findMany({ select: { id: true, name: true } }),
        prisma.product.findMany({ where: { organizationId }, select: { id: true, name: true } }),
        prisma.bank.findMany({ where: { organizationId }, select: { id: true, name: true } }),
        prisma.qBEntityMapping.findMany({
          where: { organizationId, isActive: true },
          select: { entityType: true, localId: true, qbId: true },
        }),
      ]);

      // 2a. Filter out already-mapped entities (both local and QB)
      const mappedLocalIds = new Map<string, Set<string>>();
      const mappedQBIds = new Map<string, Set<string>>();

      for (const mapping of existingMappings) {
        // Track mapped local IDs
        if (!mappedLocalIds.has(mapping.entityType)) {
          mappedLocalIds.set(mapping.entityType, new Set());
        }
        mappedLocalIds.get(mapping.entityType)!.add(mapping.localId);

        // Track mapped QB IDs
        if (!mappedQBIds.has(mapping.entityType)) {
          mappedQBIds.set(mapping.entityType, new Set());
        }
        mappedQBIds.get(mapping.entityType)!.add(mapping.qbId);
      }

      // Get already-mapped account need keys
      const mappedAccountNeedKeys = mappedLocalIds.get('account') || new Set();

      const unmappedCustomers = customers.filter(c => !mappedLocalIds.get('customer')?.has(c.id));
      const unmappedFuelTypes = fuelTypes.filter(f => !mappedLocalIds.get('item')?.has(f.id));
      const unmappedProducts = products.filter(p => !mappedLocalIds.get('item')?.has(p.id));
      const unmappedBanks = banks.filter(b => !mappedLocalIds.get('bank')?.has(b.id));

      console.log('[Auto-Match] Filtered entities:', {
        customers: { total: customers.length, unmapped: unmappedCustomers.length },
        items: { total: fuelTypes.length + products.length, unmapped: unmappedFuelTypes.length + unmappedProducts.length },
        banks: { total: banks.length, unmapped: unmappedBanks.length },
        mappedQBIds: {
          accounts: mappedQBIds.get('account')?.size || 0,
          customers: mappedQBIds.get('customer')?.size || 0,
          items: mappedQBIds.get('item')?.size || 0,
          banks: mappedQBIds.get('bank')?.size || 0,
        },
      });

      // 3. Match Accounts (exclude already-mapped QB accounts AND account needs)
      const { items: accountItems, matched: accountsMatched, candidates: accountsCandidates, unmatched: accountsUnmatched, unmappedQB } =
        await this.matchAccounts(snapshot.accounts, mappedQBIds.get('account') || new Set(), mappedAccountNeedKeys);

      // 4. Match Customers (only unmapped, exclude already-mapped QB customers)
      const { items: customerItems, matched: customersMatched, candidates: customersCandidates, unmatched: customersUnmatched } =
        this.matchCustomers(unmappedCustomers, snapshot.customers, mappedQBIds.get('customer') || new Set());

      // 5. Match Items (Fuel Types + Products, only unmapped, exclude already-mapped QB items)
      const allUnmappedItems = [
        ...unmappedFuelTypes.map(f => ({ ...f, localType: 'fuel' as const })),
        ...unmappedProducts.map(p => ({ ...p, localType: 'product' as const })),
      ];
      const { items: itemItems, matched: itemsMatched, candidates: itemsCandidates, unmatched: itemsUnmatched } =
        this.matchItems(allUnmappedItems, snapshot.items, mappedQBIds.get('item') || new Set());

      // 6. Match Banks (only unmapped, exclude already-mapped QB banks)
      const { items: bankItems, matched: banksMatched, candidates: banksCandidates, unmatched: banksUnmatched } =
        this.matchBanks(unmappedBanks, snapshot.accounts, mappedQBIds.get('bank') || new Set()); // Banks match to QB Bank accounts

      // 6a. Find unmapped QB entities (QB entities not matched to any POS entity)
      const mappedQBCustomerIds = new Set(
        customerItems.filter(i => i.bestMatch).map(i => i.bestMatch!.qbEntityId)
      );
      const unmappedQBCustomers = snapshot.customers
        .filter(qbCust => !mappedQBCustomerIds.has(qbCust.Id))
        .map(qbCust => ({
          id: qbCust.Id,
          name: qbCust.DisplayName,
        }));

      const mappedQBItemIds = new Set(
        itemItems.filter(i => i.bestMatch).map(i => i.bestMatch!.qbEntityId)
      );
      const unmappedQBItems = snapshot.items
        .filter(qbItem => !mappedQBItemIds.has(qbItem.Id))
        .map(qbItem => ({
          id: qbItem.Id,
          name: qbItem.Name,
          type: qbItem.Type,
        }));

      const mappedQBBankIds = new Set(
        bankItems.filter(i => i.bestMatch).map(i => i.bestMatch!.qbEntityId)
      );
      const unmappedQBBanks = snapshot.accounts
        .filter(qbAcct => qbAcct.AccountType === 'Bank' && !mappedQBBankIds.has(qbAcct.Id))
        .map(qbAcct => ({
          id: qbAcct.Id,
          name: qbAcct.Name,
        }));

      // 7. Compute overall health
      const accountsTotal = FUEL_STATION_NEEDS.length;
      const accountsRequired = FUEL_STATION_NEEDS.filter((n) => n.required).length;
      const accountsRequiredMatched = accountItems.filter(
        (item) => item.required && item.status === 'matched'
      ).length;
      const accountsHealthGrade = computeHealthGrade(accountsMatched, accountsCandidates, accountsTotal);
      const accountsCoveragePct = accountsTotal > 0 ? Math.round((accountsMatched / accountsTotal) * 100) : 0;

      const totalEntities = accountsTotal + unmappedCustomers.length + allUnmappedItems.length + unmappedBanks.length;
      const totalMatched = accountsMatched + customersMatched + itemsMatched + banksMatched;
      const overallCoveragePct = totalEntities > 0 ? Math.round((totalMatched / totalEntities) * 100) : 0;
      const overallHealthGrade = computeHealthGrade(
        totalMatched,
        accountsCandidates + customersCandidates + itemsCandidates + banksCandidates,
        totalEntities
      );

      // 8. Build result
      const resultId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result: MatchResult = {
        id: resultId,
        createdAt: new Date().toISOString(),
        isLive: true,

        accountsTotal,
        accountsMatched,
        accountsCandidates,
        accountsUnmatched,
        accountsRequired,
        accountsRequiredMatched,
        accountsCoveragePct,
        accountsHealthGrade,
        accountItems,
        unmappedQBAccounts: unmappedQB,

        customersTotal: unmappedCustomers.length,
        customersMatched,
        customersCandidates,
        customersUnmatched,
        customerItems,
        unmappedQBCustomers,

        itemsTotal: allUnmappedItems.length,
        itemsMatched,
        itemsCandidates,
        itemsUnmatched,
        itemItems,
        unmappedQBItems,

        banksTotal: unmappedBanks.length,
        banksMatched,
        banksCandidates,
        banksUnmatched,
        bankItems,
        unmappedQBBanks,

        overallHealthGrade,
        overallCoveragePct,
      };

      matchStore.set(resultId, result);
      return result;
    } catch (error: any) {
      if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.message?.includes('expired')) {
        throw new QBTokenExpiredError();
      }
      throw error;
    }
  }

  /**
   * Match POS account needs against QB Chart of Accounts
   */
  private static async matchAccounts(qbAccounts: any[], excludeQBIds: Set<string> = new Set(), excludeNeedKeys: Set<string> = new Set()) {
    const items: MatchItem[] = [];
    const matchedAccountIds: Set<string> = new Set();
    let matchedCount = 0;
    let candidateCount = 0;
    let unmatchedCount = 0;

    // Filter out already-mapped QB accounts from candidate pool
    const availableQBAccounts = qbAccounts.filter(a => !excludeQBIds.has(a.Id));

    console.log('[matchAccounts] Filtering QB accounts:', {
      total: qbAccounts.length,
      excludedQBIds: excludeQBIds.size,
      excludedNeedKeys: excludeNeedKeys.size,
      available: availableQBAccounts.length,
    });

    // Filter out already-mapped account needs
    const unmappedNeeds = FUEL_STATION_NEEDS.filter(need => !excludeNeedKeys.has(need.key));

    console.log('[matchAccounts] Account needs:', {
      total: FUEL_STATION_NEEDS.length,
      unmapped: unmappedNeeds.length,
    });

    for (const need of unmappedNeeds) {
      let candidates = findBestMatches(
        need.label,
        need.expectedQBTypes[0] || 'Income',
        availableQBAccounts.map((a) => ({
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

      // Also try each search hint (use filtered accounts)
      for (const hint of need.searchHints) {
        const hintCandidates = findBestMatches(
          hint,
          need.expectedQBTypes[0] || 'Income',
          availableQBAccounts.map((a) => ({
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

        const existingIds = new Set(candidates.map((c) => c.qbEntityId));
        for (const hc of hintCandidates) {
          if (!existingIds.has(hc.qbEntityId)) {
            candidates.push(hc);
            existingIds.add(hc.qbEntityId);
          } else {
            const idx = candidates.findIndex((c) => c.qbEntityId === hc.qbEntityId);
            if (idx >= 0 && hc.score > candidates[idx].score) {
              candidates[idx] = hc;
            }
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      candidates = candidates.slice(0, 5);

      const item = buildMatchItem(need, candidates);
      items.push(item);

      if (item.status === 'matched' && item.bestMatch) {
        matchedAccountIds.add(item.bestMatch.qbEntityId);
        matchedCount++;
      } else if (item.status === 'candidates') {
        candidateCount++;
      } else {
        unmatchedCount++;
      }
    }

    // Find unmapped QB accounts
    const unmappedQB = qbAccounts
      .filter((acct) => !matchedAccountIds.has(acct.Id))
      .map((acct) => ({
        qbAccountId: acct.Id,
        qbAccountName: acct.Name,
        qbAccountType: acct.AccountType,
        qbAccountSubType: acct.AccountSubType,
        active: acct.Active,
        suggestedMappingType: suggestMappingType(acct.Name, acct.AccountType),
      }));

    return { items, matched: matchedCount, candidates: candidateCount, unmatched: unmatchedCount, unmappedQB };
  }

  /**
   * Match POS customers against QB Customers
   */
  private static matchCustomers(
    localCustomers: Array<{ id: string; name: string }>,
    qbCustomers: any[],
    excludeQBIds: Set<string> = new Set()
  ) {
    const items: EntityMatchItem[] = [];
    let matchedCount = 0;
    let candidateCount = 0;
    let unmatchedCount = 0;

    // Filter out already-mapped QB customers
    const availableQBCustomers = qbCustomers.filter(c => !excludeQBIds.has(c.Id));

    console.log('[matchCustomers] Filtering QB customers:', {
      total: qbCustomers.length,
      excluded: excludeQBIds.size,
      available: availableQBCustomers.length,
    });

    for (const customer of localCustomers) {
      const candidates = findBestMatches(
        customer.name,
        'Customer',
        availableQBCustomers.map((c) => ({
          id: c.Id,
          name: c.DisplayName,
          type: 'Customer',
        })),
        ['Customer'],
        undefined,
        5,
        0.15
      );

      const item = buildEntityMatchItem(customer.id, customer.name, 'customer', candidates);
      items.push(item);

      if (item.status === 'matched') matchedCount++;
      else if (item.status === 'candidates') candidateCount++;
      else unmatchedCount++;
    }

    return { items, matched: matchedCount, candidates: candidateCount, unmatched: unmatchedCount };
  }

  /**
   * Match POS items (fuel types + products) against QB Items
   */
  private static matchItems(
    localItems: Array<{ id: string; name: string; localType: 'fuel' | 'product' }>,
    qbItems: any[],
    excludeQBIds: Set<string> = new Set()
  ) {
    const items: EntityMatchItem[] = [];
    let matchedCount = 0;
    let candidateCount = 0;
    let unmatchedCount = 0;

    // Filter out already-mapped QB items
    const availableQBItems = qbItems.filter(i => !excludeQBIds.has(i.Id));

    console.log('[matchItems] Filtering QB items:', {
      total: qbItems.length,
      excluded: excludeQBIds.size,
      available: availableQBItems.length,
    });

    for (const localItem of localItems) {
      const candidates = findBestMatches(
        localItem.name,
        'Item',
        availableQBItems.map((i) => ({
          id: i.Id,
          name: i.Name,
          type: i.Type || 'Item',
        })),
        ['Inventory', 'Service', 'NonInventory'],
        undefined,
        5,
        0.15
      );

      const item = buildEntityMatchItem(localItem.id, localItem.name, 'item', candidates);
      items.push(item);

      if (item.status === 'matched') matchedCount++;
      else if (item.status === 'candidates') candidateCount++;
      else unmatchedCount++;
    }

    return { items, matched: matchedCount, candidates: candidateCount, unmatched: unmatchedCount };
  }

  /**
   * Match POS banks against QB Bank accounts
   */
  private static matchBanks(
    localBanks: Array<{ id: string; name: string }>,
    qbAccounts: any[],
    excludeQBIds: Set<string> = new Set()
  ) {
    const items: EntityMatchItem[] = [];
    let matchedCount = 0;
    let candidateCount = 0;
    let unmatchedCount = 0;

    // Filter QB accounts to only bank-type accounts
    const bankAccounts = qbAccounts.filter((a) =>
      ['Bank', 'Other Current Asset'].includes(a.AccountType)
    );

    // Filter out already-mapped QB banks
    const availableBankAccounts = bankAccounts.filter(a => !excludeQBIds.has(a.Id));

    console.log('[matchBanks] Filtering QB bank accounts:', {
      totalBankAccounts: bankAccounts.length,
      excluded: excludeQBIds.size,
      available: availableBankAccounts.length,
    });

    for (const bank of localBanks) {
      const candidates = findBestMatches(
        bank.name,
        'Bank',
        availableBankAccounts.map((a) => ({
          id: a.Id,
          name: a.Name,
          account_type: a.AccountType,
        })),
        ['Bank', 'Other Current Asset'],
        undefined,
        5,
        0.15
      );

      const item = buildEntityMatchItem(bank.id, bank.name, 'bank', candidates);
      items.push(item);

      if (item.status === 'matched') matchedCount++;
      else if (item.status === 'candidates') candidateCount++;
      else unmatchedCount++;
    }

    return { items, matched: matchedCount, candidates: candidateCount, unmatched: unmatchedCount };
  }

  /**
   * Get stored match result
   */
  static getResult(resultId: string): MatchResult | null {
    return matchStore.get(resultId) || null;
  }

  /**
   * Update admin decisions for accounts
   */
  static updateAccountDecisions(
    resultId: string,
    decisions: Array<{
      needKey: string;
      decision: 'use_existing' | 'create_new';
      accountId?: string;
      accountName?: string;
    }>
  ): MatchResult {
    const result = matchStore.get(resultId);
    if (!result) throw new Error(`Match result ${resultId} not found`);

    for (const dec of decisions) {
      const item = result.accountItems.find((i) => i.needKey === dec.needKey);
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
   * Update admin decisions for entities (customers, items, banks)
   */
  static updateEntityDecisions(
    resultId: string,
    entityType: 'customer' | 'item' | 'bank',
    decisions: Array<{
      localId: string;
      decision: 'use_existing' | 'create_new';
      qbEntityId?: string;
      qbEntityName?: string;
    }>
  ): MatchResult {
    const result = matchStore.get(resultId);
    if (!result) throw new Error(`Match result ${resultId} not found`);

    const itemsArray =
      entityType === 'customer' ? result.customerItems :
      entityType === 'item' ? result.itemItems :
      result.bankItems;

    for (const dec of decisions) {
      const item = itemsArray.find((i) => i.localId === dec.localId);
      if (item) {
        item.decision = dec.decision;
        item.decisionEntityId = dec.qbEntityId || null;
        item.decisionEntityName = dec.qbEntityName || null;
      }
    }

    matchStore.set(resultId, result);
    return result;
  }

  /**
   * Apply account mapping decisions to database
   */
  static async applyAccountDecisions(
    resultId: string,
    organizationId: string,
    userId?: string
  ): Promise<{
    success: boolean;
    batchId: string;
    mappingsCreated: number;
    errors: Array<{ needKey: string; error: string }>;
  }> {
    const result = matchStore.get(resultId);
    if (!result) throw new Error(`Match result ${resultId} not found`);

    // Create batch to track this apply operation
    const batchId = await MappingBatchService.createBatch(organizationId, userId || 'system', 'auto_match');


    let mappingsCreated = 0;
    const errors: Array<{ needKey: string; error: string }> = [];

    for (const item of result.accountItems) {
      if (!item.decision) continue;

      try {
        if (item.decision === 'use_existing' && item.decisionAccountId) {
          await EntityMappingService.upsertMapping(
            organizationId,
            'account',
            item.needKey,
            item.decisionAccountId,
            item.decisionAccountName,
            { batchId, userId }
          );
          mappingsCreated++;
        } else if (item.decision === 'create_new') {
          // Create new QB Account
          const { accessToken, realmId } = await getValidAccessToken(organizationId, prisma);
          const apiUrl = getQBApiUrl();

          // Determine QB account type and subtype from expected types
          const qbAccountType = item.expectedQBTypes[0] || 'Income';
          const qbAccountSubType = item.expectedQBSubType;

          const accountPayload: any = {
            Name: item.needLabel,
            AccountType: qbAccountType,
            Active: true,
          };

          if (qbAccountSubType) {
            accountPayload.AccountSubType = qbAccountSubType;
          }

          const response = await fetch(`${apiUrl}/v3/company/${realmId}/account`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(accountPayload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QB API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json() as any;
          const newAccount = data.Account;

          // Create mapping with batch tracking
          await EntityMappingService.upsertMapping(
            organizationId,
            'account',
            item.needKey,
            newAccount.Id,
            newAccount.Name,
            { batchId, userId }
          );
          mappingsCreated++;
        }
      } catch (err) {
        errors.push({ needKey: item.needKey, error: `Failed to map ${item.needLabel}: ${(err as Error).message}` });
      }
    }

    return { success: errors.length === 0, batchId, mappingsCreated, errors };
  }

  /**
   * Apply entity mapping decisions to database
   */
  static async applyEntityDecisions(
    resultId: string,
    organizationId: string,
    entityType: 'customer' | 'item' | 'bank',
    userId?: string
  ): Promise<{
    success: boolean;
    batchId: string;
    mappingsCreated: number;
    errors: Array<{ localId: string; error: string }>;
  }> {
    const result = matchStore.get(resultId);
    if (!result) throw new Error(`Match result ${resultId} not found`);

    const itemsArray =
      entityType === 'customer' ? result.customerItems :
      entityType === 'item' ? result.itemItems :
      result.bankItems;

    // Create batch to track this apply operation
    const batchId = await MappingBatchService.createBatch(organizationId, userId || 'system', 'auto_match');


    let mappingsCreated = 0;
    const errors: Array<{ localId: string; error: string }> = [];

    for (const item of itemsArray) {
      if (!item.decision) continue;

      try {
        if (item.decision === 'use_existing' && item.decisionEntityId) {
          await EntityMappingService.upsertMapping(
            organizationId,
            entityType,
            item.localId,
            item.decisionEntityId,
            item.decisionEntityName,
            { batchId, userId }
          );
          mappingsCreated++;
        } else if (item.decision === 'create_new') {
          // Create new QB entity
          const { accessToken, realmId } = await getValidAccessToken(organizationId, prisma);
          const apiUrl = getQBApiUrl();

          let endpoint = '';
          let entityPayload: any = {};
          let createdEntity: any = null;

          if (entityType === 'customer') {
            endpoint = 'customer';
            entityPayload = {
              DisplayName: item.localName,
              Active: true,
            };
          } else if (entityType === 'item') {
            endpoint = 'item';
            // Determine item type (default to Service for fuel types/products)
            entityPayload = {
              Name: item.localName,
              Type: 'Service',
              Active: true,
            };
          } else if (entityType === 'bank') {
            endpoint = 'account';
            entityPayload = {
              Name: item.localName,
              AccountType: 'Bank',
              Active: true,
            };
          }

          const response = await fetch(`${apiUrl}/v3/company/${realmId}/${endpoint}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(entityPayload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QB API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json() as any;

          // Extract created entity based on type
          if (entityType === 'customer') {
            createdEntity = data.Customer;
          } else if (entityType === 'item') {
            createdEntity = data.Item;
          } else if (entityType === 'bank') {
            createdEntity = data.Account;
          }

          // Create mapping with batch tracking
          await EntityMappingService.upsertMapping(
            organizationId,
            entityType,
            item.localId,
            createdEntity.Id,
            createdEntity.DisplayName || createdEntity.Name,
            { batchId, userId }
          );
          mappingsCreated++;
        }
      } catch (err) {
        errors.push({ localId: item.localId, error: `Failed to map ${item.localName}: ${(err as Error).message}` });
      }
    }

    return { success: errors.length === 0, batchId, mappingsCreated, errors };
  }
}
