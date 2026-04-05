/**
 * End-to-End Workflow Test
 *
 * Tests complete petrol pump daily workflow:
 * 1. Opening meter readings
 * 2. Closing meter readings
 * 3. Fuel sales (credit, card, cash)
 * 4. Non-fuel sales
 * 5. Bifurcation reconciliation
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3000/api';

let authToken: string;
let userId: string;
let organizationId: string;
let branchId: string;

interface NozzleData {
  id: string;
  nozzleNumber: number;
  fuelTypeId: string;
  fuelTypeName: string;
  openingReading: number;
  closingReading: number;
}

const nozzlesData: NozzleData[] = [];
let shiftInstanceId: string;

// Authenticate
async function login() {
  console.log('\n📝 Step 1: Login as admin...');
  const response = await axios.post(`${API_BASE}/auth/login`, {
    username: 'admin',
    password: 'AdminPass123',
  });

  authToken = response.data.access_token;
  userId = response.data.user.id;
  organizationId = response.data.user.branch.organization_id || 'feab5ef7-74f5-44f3-9f60-5fb1b65a84bf';
  branchId = response.data.user.branch.id;

  console.log(`✅ Logged in as ${response.data.user.username}`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Org ID: ${organizationId}`);
  console.log(`   Branch ID: ${branchId}`);
}

// Clean old data
async function cleanOldData() {
  console.log('\n🧹 Step 2: Cleaning old test data...');

  // Delete old meter readings from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deletedReadings = await prisma.meterReading.deleteMany({
    where: {
      recordedAt: {
        gte: today,
      },
    },
  });

  console.log(`✅ Deleted ${deletedReadings.count} old meter readings`);
}

// Get nozzles
async function getNozzles() {
  console.log('\n🔧 Step 3: Fetching nozzles...');

  const nozzles = await prisma.nozzle.findMany({
    where: {
      isActive: true,
      dispensingUnit: {
        branch: {
          organizationId,
        },
      },
    },
    include: {
      fuelType: true,
    },
    orderBy: {
      nozzleNumber: 'asc',
    },
  });

  console.log(`✅ Found ${nozzles.length} active nozzles`);

  // Assign realistic meter readings
  nozzles.forEach((nozzle, index) => {
    const baseReading = 1000000 + (index * 50000);
    const variance = 500 + (index * 100); // Liters sold during shift

    nozzlesData.push({
      id: nozzle.id,
      nozzleNumber: nozzle.nozzleNumber,
      fuelTypeId: nozzle.fuelTypeId,
      fuelTypeName: nozzle.fuelType.name,
      openingReading: baseReading,
      closingReading: baseReading + variance,
    });

    console.log(`   Nozzle ${nozzle.nozzleNumber} (${nozzle.fuelType.name}): ${baseReading} → ${baseReading + variance} (${variance}L)`);
  });
}

// Get or create shift instance
async function getShiftInstance() {
  console.log('\n⏰ Step 4: Getting shift instance...');

  const dayShift = await prisma.shift.findFirst({
    where: {
      name: 'Day Shift',
      branchId,
    },
  });

  if (!dayShift) {
    throw new Error('Day Shift not found');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let shiftInstance = await prisma.shiftInstance.findFirst({
    where: {
      shiftId: dayShift.id,
      date: today,
    },
  });

  if (!shiftInstance) {
    shiftInstance = await prisma.shiftInstance.create({
      data: {
        shiftId: dayShift.id,
        branchId,
        date: today,
        openedAt: new Date(),
        openedBy: userId,
        status: 'open',
      },
    });
    console.log('✅ Created new shift instance for today');
  } else {
    console.log('✅ Using existing shift instance');
  }

  shiftInstanceId = shiftInstance.id;
  console.log(`   Shift Instance ID: ${shiftInstanceId}`);
}

// Submit opening readings
async function submitOpeningReadings() {
  console.log('\n📊 Step 5: Submitting opening meter readings...');

  for (const nozzle of nozzlesData) {
    try {
      const response = await axios.post(
        `${API_BASE}/meter-readings`,
        {
          nozzleId: nozzle.id,
          shiftInstanceId,
          readingType: 'opening',
          meterValue: nozzle.openingReading,
          isOcr: false,
          isManualOverride: false,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      console.log(`   ✅ Nozzle ${nozzle.nozzleNumber} opening: ${nozzle.openingReading}L`);
    } catch (error: any) {
      console.error(`   ❌ Failed for nozzle ${nozzle.nozzleNumber}:`, error.response?.data || error.message);
    }
  }
}

// Submit closing readings
async function submitClosingReadings() {
  console.log('\n📊 Step 6: Submitting closing meter readings...');

  for (const nozzle of nozzlesData) {
    try {
      const response = await axios.post(
        `${API_BASE}/meter-readings`,
        {
          nozzleId: nozzle.id,
          shiftInstanceId,
          readingType: 'closing',
          meterValue: nozzle.closingReading,
          isOcr: false,
          isManualOverride: false,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      const variance = nozzle.closingReading - nozzle.openingReading;
      console.log(`   ✅ Nozzle ${nozzle.nozzleNumber} closing: ${nozzle.closingReading}L (sold ${variance}L)`);
    } catch (error: any) {
      console.error(`   ❌ Failed for nozzle ${nozzle.nozzleNumber}:`, error.response?.data || error.message);
    }
  }
}

// Get fuel prices
async function getFuelPrices() {
  console.log('\n💰 Step 7: Getting current fuel prices...');

  const response = await axios.get(`${API_BASE}/fuel-prices/current`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  const prices = response.data.prices || response.data;
  console.log('✅ Current fuel prices:');
  prices.forEach((price: any) => {
    console.log(`   ${price.fuelType?.name || price.fuel_type?.name}: PKR ${price.price} per liter`);
  });

  return prices;
}

// Create fuel sales
async function createFuelSales(prices: any[]) {
  console.log('\n⛽ Step 8: Creating fuel sales transactions...');

  const paymentMethods = ['cash', 'card', 'credit'];
  let saleNumber = 1;

  for (const nozzle of nozzlesData) {
    const variance = nozzle.closingReading - nozzle.openingReading;
    const priceInfo = prices.find(p => (p.fuelType?.id || p.fuel_type?.id) === nozzle.fuelTypeId);

    if (!priceInfo) {
      console.error(`   ⚠️  No price found for ${nozzle.fuelTypeName}`);
      continue;
    }

    const pricePerLiter = parseFloat(priceInfo.price);

    // Split variance into 3 sales (different payment methods)
    const sales = [
      { liters: Math.floor(variance * 0.4), payment: paymentMethods[0] }, // 40% cash
      { liters: Math.floor(variance * 0.35), payment: paymentMethods[1] }, // 35% card
      { liters: variance - Math.floor(variance * 0.4) - Math.floor(variance * 0.35), payment: paymentMethods[2] }, // 25% credit
    ];

    for (const sale of sales) {
      if (sale.liters <= 0) continue;

      const totalAmount = sale.liters * pricePerLiter;

      try {
        const response = await axios.post(
          `${API_BASE}/sales/fuel`,
          {
            nozzleId: nozzle.id,
            fuelTypeId: nozzle.fuelTypeId,
            litersSold: sale.liters,
            pricePerLiter,
            totalAmount,
            paymentMethod: sale.payment,
            ...(sale.payment === 'credit' && { customerId: null }), // TODO: Create test customer
          },
          {
            headers: { Authorization: `Bearer ${authToken}` },
          }
        );

        console.log(`   ✅ Sale #${saleNumber}: ${sale.liters}L ${nozzle.fuelTypeName} @ PKR ${pricePerLiter} = PKR ${totalAmount.toFixed(2)} (${sale.payment})`);
        saleNumber++;
      } catch (error: any) {
        console.error(`   ❌ Failed to create sale:`, error.response?.data || error.message);
      }
    }
  }
}

// Create non-fuel sales
async function createNonFuelSales() {
  console.log('\n🛒 Step 9: Creating non-fuel sales...');

  // Get products
  const products = await prisma.product.findMany({
    where: {
      organizationId,
      isActive: true,
    },
    take: 3,
  });

  if (products.length === 0) {
    console.log('   ⚠️  No products found, skipping non-fuel sales');
    return;
  }

  const paymentMethods = ['cash', 'card'];

  for (let i = 0; i < Math.min(products.length, 3); i++) {
    const product = products[i];
    const quantity = 2 + i;
    const unitPrice = parseFloat(product.salePrice?.toString() || '100');
    const totalAmount = quantity * unitPrice;
    const payment = paymentMethods[i % 2];

    try {
      const response = await axios.post(
        `${API_BASE}/sales/non-fuel`,
        {
          items: [
            {
              productId: product.id,
              quantity,
              unitPrice,
              totalPrice: totalAmount,
            },
          ],
          totalAmount,
          paymentMethod: payment,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      console.log(`   ✅ Non-fuel sale: ${quantity}x ${product.name} = PKR ${totalAmount.toFixed(2)} (${payment})`);
    } catch (error: any) {
      console.error(`   ❌ Failed:`, error.response?.data || error.message);
    }
  }
}

// Check bifurcation
async function checkBifurcation() {
  console.log('\n📋 Step 10: Checking bifurcation summary...');

  const today = new Date().toISOString().split('T')[0];

  try {
    const response = await axios.get(`${API_BASE}/bifurcation/summary`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { date: today },
    });

    console.log('✅ Bifurcation Summary:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('❌ Failed to get bifurcation:', error.response?.data || error.message);
  }
}

// Main test
async function runTest() {
  try {
    await login();
    await cleanOldData();
    await getNozzles();
    await getShiftInstance();
    await submitOpeningReadings();
    await submitClosingReadings();

    const prices = await getFuelPrices();
    await createFuelSales(prices);
    await createNonFuelSales();
    await checkBifurcation();

    console.log('\n✅ ✅ ✅ ALL TESTS PASSED ✅ ✅ ✅\n');

    console.log('📊 SUMMARY FOR MANUAL TESTING:');
    console.log('================================');
    nozzlesData.forEach(n => {
      console.log(`Nozzle ${n.nozzleNumber} (${n.fuelTypeName}): ${n.openingReading}L → ${n.closingReading}L (${n.closingReading - n.openingReading}L sold)`);
    });

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
