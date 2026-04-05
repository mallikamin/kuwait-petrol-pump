/**
 * Fetch QuickBooks Entities for Mapping
 * Queries QB to find Customers, Items, and Payment Methods
 */

import { PrismaClient } from '@prisma/client';
import { decryptToken } from '../src/services/quickbooks/encryption';
import OAuthClient from 'intuit-oauth';

const prisma = new PrismaClient();

async function fetchQBEntities() {
  try {
    console.log('🔍 Fetching QuickBooks entities...\n');

    // Get active QB connection
    const connection = await prisma.qBConnection.findFirst({
      where: { isActive: true },
      include: { organization: true },
    });

    if (!connection) {
      console.error('❌ No active QuickBooks connection found');
      process.exit(1);
    }

    console.log(`✅ Connected to: ${connection.companyName}`);
    console.log(`   Organization: ${connection.organization.name}`);
    console.log(`   Realm ID: ${connection.realmId}\n`);

    // Decrypt tokens
    const accessToken = decryptToken(connection.accessTokenEncrypted);

    // Initialize OAuth client
    const oauthClient = new OAuthClient({
      clientId: process.env.QUICKBOOKS_CLIENT_ID || '',
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || '',
      environment: (process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
      redirectUri: process.env.QUICKBOOKS_REDIRECT_URI || '',
    });

    const apiUrl =
      process.env.QUICKBOOKS_ENVIRONMENT === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com';

    // Fetch Customers
    console.log('📋 Fetching Customers...');
    const customersResponse = await fetch(
      `${apiUrl}/v3/company/${connection.realmId}/query?query=SELECT * FROM Customer MAXRESULTS 100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!customersResponse.ok) {
      console.error(`❌ Failed to fetch customers: ${customersResponse.statusText}`);
    } else {
      const customersData = await customersResponse.json();
      const customers = customersData.QueryResponse?.Customer || [];
      console.log(`   Found ${customers.length} customers\n`);

      console.log('💡 Suggested Walk-In Customer Mappings:');
      const walkInCustomers = customers.filter((c: any) =>
        c.DisplayName?.toLowerCase().includes('cash') ||
        c.DisplayName?.toLowerCase().includes('walk') ||
        c.DisplayName?.toLowerCase().includes('walk-in')
      );

      if (walkInCustomers.length > 0) {
        walkInCustomers.forEach((c: any) => {
          console.log(`   - "${c.DisplayName}" (ID: ${c.Id})`);
        });
      } else {
        console.log('   ⚠️  No "Cash" or "Walk-In" customer found');
        console.log('   📝 First 5 customers:');
        customers.slice(0, 5).forEach((c: any) => {
          console.log(`      - "${c.DisplayName}" (ID: ${c.Id})`);
        });
      }
      console.log('');
    }

    // Fetch Items (Products/Services)
    console.log('📦 Fetching Items...');
    const itemsResponse = await fetch(
      `${apiUrl}/v3/company/${connection.realmId}/query?query=SELECT * FROM Item MAXRESULTS 100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!itemsResponse.ok) {
      console.error(`❌ Failed to fetch items: ${itemsResponse.statusText}`);
    } else {
      const itemsData = await itemsResponse.json();
      const items = itemsData.QueryResponse?.Item || [];
      console.log(`   Found ${items.length} items\n`);

      console.log('💡 Suggested Fuel Item Mappings:');

      // Look for Premium Gasoline / Petrol / PMG
      const premiumItems = items.filter((i: any) =>
        i.Name?.toLowerCase().includes('premium') ||
        i.Name?.toLowerCase().includes('petrol') ||
        i.Name?.toLowerCase().includes('gasoline') ||
        i.Name?.toLowerCase().includes('pmg')
      );

      console.log('   Premium Gasoline (PMG):');
      if (premiumItems.length > 0) {
        premiumItems.forEach((i: any) => {
          console.log(`      - "${i.Name}" (ID: ${i.Id}, Type: ${i.Type})`);
        });
      } else {
        console.log('      ⚠️  No premium/petrol item found');
      }

      // Look for Diesel / HSD
      const dieselItems = items.filter((i: any) =>
        i.Name?.toLowerCase().includes('diesel') ||
        i.Name?.toLowerCase().includes('hsd')
      );

      console.log('   High Speed Diesel (HSD):');
      if (dieselItems.length > 0) {
        dieselItems.forEach((i: any) => {
          console.log(`      - "${i.Name}" (ID: ${i.Id}, Type: ${i.Type})`);
        });
      } else {
        console.log('      ⚠️  No diesel item found');
      }

      console.log('\n   📝 First 10 items:');
      items.slice(0, 10).forEach((i: any) => {
        console.log(`      - "${i.Name}" (ID: ${i.Id}, Type: ${i.Type})`);
      });
      console.log('');
    }

    // Fetch Payment Methods
    console.log('💳 Fetching Payment Methods...');
    const paymentMethodsResponse = await fetch(
      `${apiUrl}/v3/company/${connection.realmId}/query?query=SELECT * FROM PaymentMethod`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!paymentMethodsResponse.ok) {
      console.error(`❌ Failed to fetch payment methods: ${paymentMethodsResponse.statusText}`);
    } else {
      const paymentMethodsData = await paymentMethodsResponse.json();
      const paymentMethods = paymentMethodsData.QueryResponse?.PaymentMethod || [];
      console.log(`   Found ${paymentMethods.length} payment methods\n`);

      console.log('💡 Payment Method Mappings:');
      paymentMethods.forEach((pm: any) => {
        console.log(`   - "${pm.Name}" (ID: ${pm.Id})`);
      });
      console.log('');
    }

    console.log('\n✅ Entity fetch complete!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Review the suggested mappings above');
    console.log('   2. Use the IDs to create mappings via API or UI');
    console.log('   3. Run preflight checks again to verify\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fetchQBEntities();
