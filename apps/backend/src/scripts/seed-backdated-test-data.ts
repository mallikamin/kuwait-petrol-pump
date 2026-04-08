/**
 * Seed Backdated Test Data
 * Creates test data for backdated entries verification:
 * - Walk-in fuel transactions
 * - Walk-in non-fuel transactions
 * - Customer credit transactions
 * - Mixed payment methods
 * - Draft and finalized states
 *
 * Run: npx ts-node src/scripts/seed-backdated-test-data.ts
 */

import { PrismaClient } from '@prisma/client';
import { subDays, format } from 'date-fns';

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed Backdated Test Data] Starting...');

  // Get organization
  const org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error('No organization found. Run main seed first.');
  }

  // Get or create test branch
  let branch = await prisma.branch.findFirst({
    where: { organizationId: org.id },
  });

  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Main Branch',
        code: 'MAIN',
        address: 'Test Address',
      },
    });
  }

  // Get or create test bank
  let bank = await prisma.bank.findFirst({
    where: { organizationId: org.id },
  });

  if (!bank) {
    bank = await prisma.bank.create({
      data: {
        organizationId: org.id,
        name: 'Test Bank',
        code: 'TEST',
        accountNumber: 'TEST-001',
      },
    });
  }

  // Get or create test customer
  let customer = await prisma.customer.findFirst({
    where: { organizationId: org.id },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        name: 'Test Customer Ltd',
        phone: '03001234567',
        email: 'test@example.com',
      },
    });
  }

  // Get or create test products (non-fuel)
  const productNames = ['Engine Oil 5W-30', 'Brake Fluid', 'Car Wash', 'Air Freshener'];
  const products = [];

  for (const name of productNames) {
    let product = await prisma.product.findFirst({
      where: { organizationId: org.id, name },
    });

    if (!product) {
      product = await prisma.product.create({
        data: {
          organizationId: org.id,
          name,
          sku: `SKU-${name.replace(/\s/g, '-').toUpperCase()}`,
          price: Math.floor(Math.random() * 1000) + 500, // Random price 500-1500
          unit: 'piece',
        },
      });
      console.log(`[Seed] ✓ Created product: ${name}`);
    }
    products.push(product);
  }

  // Test date: yesterday
  const testDate = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  console.log(`[Seed] Using test date: ${testDate}`);

  // Create backdated daily summary
  const existingSummary = await prisma.backdatedDailySummary.findFirst({
    where: {
      organizationId: org.id,
      branchId: branch.id,
      businessDate: new Date(testDate),
    },
  });

  let summary;
  if (existingSummary) {
    console.log('[Seed] ✓ Daily summary already exists');
    summary = existingSummary;
  } else {
    summary = await prisma.backdatedDailySummary.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        businessDate: new Date(testDate),
        status: 'draft',
        totalSales: 0,
        totalTransactions: 0,
      },
    });
    console.log('[Seed] ✓ Created daily summary');
  }

  // Create test transactions
  const transactions = [
    // Walk-in fuel transactions (HSD & PMG)
    {
      customerId: null,
      customerName: '',
      fuelCode: 'HSD',
      productName: 'HSD (Diesel)',
      quantity: 50.5,
      unitPrice: 288.5,
      lineTotal: 50.5 * 288.5,
      paymentMethod: 'cash',
      vehicleNumber: 'ABC-123',
      slipNumber: 'SLP-001',
    },
    {
      customerId: null,
      customerName: '',
      fuelCode: 'PMG',
      productName: 'PMG (Petrol)',
      quantity: 30.25,
      unitPrice: 295.8,
      lineTotal: 30.25 * 295.8,
      paymentMethod: 'cash',
      vehicleNumber: 'XYZ-789',
      slipNumber: 'SLP-002',
    },
    // Walk-in non-fuel transactions
    {
      customerId: null,
      customerName: '',
      fuelCode: 'OTHER',
      productName: products[0].name,
      quantity: 2,
      unitPrice: products[0].price,
      lineTotal: 2 * products[0].price,
      paymentMethod: 'cash',
    },
    {
      customerId: null,
      customerName: '',
      fuelCode: 'OTHER',
      productName: products[1].name,
      quantity: 1,
      unitPrice: products[1].price,
      lineTotal: 1 * products[1].price,
      paymentMethod: 'credit_card',
      bankId: bank.id,
    },
    // Customer credit transactions
    {
      customerId: customer.id,
      customerName: customer.name,
      fuelCode: 'HSD',
      productName: 'HSD (Diesel)',
      quantity: 100.0,
      unitPrice: 288.5,
      lineTotal: 100.0 * 288.5,
      paymentMethod: 'credit_customer',
      vehicleNumber: 'LHR-1234',
      slipNumber: 'SLP-CUST-001',
    },
    {
      customerId: customer.id,
      customerName: customer.name,
      fuelCode: 'PMG',
      productName: 'PMG (Petrol)',
      quantity: 75.5,
      unitPrice: 295.8,
      lineTotal: 75.5 * 295.8,
      paymentMethod: 'credit_customer',
      vehicleNumber: 'LHR-5678',
      slipNumber: 'SLP-CUST-002',
    },
    // Mixed payment: customer with bank card
    {
      customerId: customer.id,
      customerName: customer.name,
      fuelCode: 'HSD',
      productName: 'HSD (Diesel)',
      quantity: 45.0,
      unitPrice: 288.5,
      lineTotal: 45.0 * 288.5,
      paymentMethod: 'bank_card',
      bankId: bank.id,
      vehicleNumber: 'ISB-9999',
      slipNumber: 'SLP-CARD-001',
    },
    // Customer non-fuel purchase
    {
      customerId: customer.id,
      customerName: customer.name,
      fuelCode: 'OTHER',
      productName: products[2].name,
      quantity: 3,
      unitPrice: products[2].price,
      lineTotal: 3 * products[2].price,
      paymentMethod: 'credit_customer',
    },
  ];

  let createdCount = 0;
  for (const txn of transactions) {
    const existing = await prisma.backdatedTransaction.findFirst({
      where: {
        backdatedDailySummaryId: summary.id,
        fuelCode: txn.fuelCode as any,
        productName: txn.productName,
        quantity: txn.quantity,
      },
    });

    if (!existing) {
      await prisma.backdatedTransaction.create({
        data: {
          backdatedDailySummaryId: summary.id,
          ...txn,
        } as any,
      });
      createdCount++;
    }
  }

  console.log(`[Seed] ✓ Created ${createdCount} new transactions (${transactions.length - createdCount} already existed)`);

  // Update summary totals
  const allTransactions = await prisma.backdatedTransaction.findMany({
    where: { backdatedDailySummaryId: summary.id },
  });

  const totalSales = allTransactions.reduce((sum, t) => sum + Number(t.lineTotal), 0);
  const totalTransactions = allTransactions.length;

  await prisma.backdatedDailySummary.update({
    where: { id: summary.id },
    data: {
      totalSales,
      totalTransactions,
    },
  });

  console.log(`[Seed] ✓ Updated summary: ${totalTransactions} transactions, PKR ${totalSales.toFixed(2)}`);
  console.log('[Seed Backdated Test Data] Complete!');
  console.log('');
  console.log('Test data includes:');
  console.log('  - Walk-in fuel sales (HSD & PMG)');
  console.log('  - Walk-in non-fuel sales (Engine Oil, Brake Fluid)');
  console.log('  - Customer credit fuel sales');
  console.log('  - Customer non-fuel purchases');
  console.log('  - Mixed payment methods (cash, credit_card, bank_card, credit_customer)');
  console.log('  - Status: draft (ready to finalize)');
}

main()
  .catch((e) => {
    console.error('[Seed Backdated Test Data] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
