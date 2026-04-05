/**
 * QuickBooks Entity Fetcher Service
 * Queries QB API to fetch Customers, Items, Accounts, Payment Methods
 */

import { PrismaClient } from '@prisma/client';
import { decryptToken } from './encryption';

const prisma = new PrismaClient();

interface QBCustomer {
  Id: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
}

interface QBItem {
  Id: string;
  Name: string;
  Type: string;
  Active: boolean;
  Description?: string;
}

interface QBAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  Active: boolean;
}

interface QBPaymentMethod {
  Id: string;
  Name: string;
  Active: boolean;
}

export interface QBEntitiesSnapshot {
  customers: QBCustomer[];
  items: QBItem[];
  accounts: QBAccount[];
  paymentMethods: QBPaymentMethod[];
  fetchedAt: string;
}

export class QuickBooksEntityFetcher {
  /**
   * Fetch all QB entities for mapping purposes
   */
  static async fetchAllEntities(organizationId: string): Promise<QBEntitiesSnapshot> {
    // Get active QB connection
    const connection = await prisma.qBConnection.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!connection) {
      throw new Error('No active QuickBooks connection found');
    }

    // Decrypt access token
    const accessToken = decryptToken(connection.accessTokenEncrypted);

    const apiUrl =
      process.env.QUICKBOOKS_ENVIRONMENT === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com';

    const realmId = connection.realmId;

    // Fetch all entity types in parallel
    const [customers, items, accounts, paymentMethods] = await Promise.all([
      this.fetchCustomers(apiUrl, realmId, accessToken),
      this.fetchItems(apiUrl, realmId, accessToken),
      this.fetchAccounts(apiUrl, realmId, accessToken),
      this.fetchPaymentMethods(apiUrl, realmId, accessToken),
    ]);

    return {
      customers,
      items,
      accounts,
      paymentMethods,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Fetch QB Customers
   */
  private static async fetchCustomers(
    apiUrl: string,
    realmId: string,
    accessToken: string
  ): Promise<QBCustomer[]> {
    const response = await fetch(
      `${apiUrl}/v3/company/${realmId}/query?query=SELECT * FROM Customer MAXRESULTS 1000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch customers: ${response.statusText}`);
    }

    const data = await response.json();
    return data.QueryResponse?.Customer || [];
  }

  /**
   * Fetch QB Items (Products/Services)
   */
  private static async fetchItems(
    apiUrl: string,
    realmId: string,
    accessToken: string
  ): Promise<QBItem[]> {
    const response = await fetch(
      `${apiUrl}/v3/company/${realmId}/query?query=SELECT * FROM Item MAXRESULTS 1000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch items: ${response.statusText}`);
    }

    const data = await response.json();
    return data.QueryResponse?.Item || [];
  }

  /**
   * Fetch QB Accounts (Chart of Accounts)
   */
  private static async fetchAccounts(
    apiUrl: string,
    realmId: string,
    accessToken: string
  ): Promise<QBAccount[]> {
    const response = await fetch(
      `${apiUrl}/v3/company/${realmId}/query?query=SELECT * FROM Account MAXRESULTS 1000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch accounts: ${response.statusText}`);
    }

    const data = await response.json();
    return data.QueryResponse?.Account || [];
  }

  /**
   * Fetch QB Payment Methods
   */
  private static async fetchPaymentMethods(
    apiUrl: string,
    realmId: string,
    accessToken: string
  ): Promise<QBPaymentMethod[]> {
    const response = await fetch(
      `${apiUrl}/v3/company/${realmId}/query?query=SELECT * FROM PaymentMethod MAXRESULTS 100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch payment methods: ${response.statusText}`);
    }

    const data = await response.json();
    return data.QueryResponse?.PaymentMethod || [];
  }

  /**
   * Suggest mappings based on name similarity
   */
  static suggestMappings(
    localEntities: Array<{ id: string; name: string }>,
    qbEntities: Array<{ Id: string; Name?: string; DisplayName?: string }>,
    entityType: string
  ): Array<{
    localId: string;
    localName: string;
    qbId: string;
    qbName: string;
    confidence: 'high' | 'medium' | 'low';
  }> {
    const suggestions: Array<{
      localId: string;
      localName: string;
      qbId: string;
      qbName: string;
      confidence: 'high' | 'medium' | 'low';
    }> = [];

    for (const local of localEntities) {
      const localNameLower = local.name.toLowerCase().trim();

      // Find best match
      let bestMatch: typeof qbEntities[0] | null = null;
      let bestScore = 0;

      for (const qb of qbEntities) {
        const qbName = qb.Name || (qb as any).DisplayName || '';
        const qbNameLower = qbName.toLowerCase().trim();

        // Exact match
        if (localNameLower === qbNameLower) {
          bestMatch = qb;
          bestScore = 100;
          break;
        }

        // Contains match
        if (qbNameLower.includes(localNameLower) || localNameLower.includes(qbNameLower)) {
          const score = 80;
          if (score > bestScore) {
            bestMatch = qb;
            bestScore = score;
          }
        }

        // Word overlap
        const localWords = localNameLower.split(/\s+/);
        const qbWords = qbNameLower.split(/\s+/);
        const overlap = localWords.filter((w) => qbWords.includes(w)).length;
        if (overlap > 0) {
          const score = (overlap / Math.max(localWords.length, qbWords.length)) * 60;
          if (score > bestScore) {
            bestMatch = qb;
            bestScore = score;
          }
        }
      }

      if (bestMatch && bestScore >= 50) {
        suggestions.push({
          localId: local.id,
          localName: local.name,
          qbId: bestMatch.Id,
          qbName: bestMatch.Name || (bestMatch as any).DisplayName || '',
          confidence: bestScore >= 90 ? 'high' : bestScore >= 70 ? 'medium' : 'low',
        });
      }
    }

    return suggestions;
  }
}
