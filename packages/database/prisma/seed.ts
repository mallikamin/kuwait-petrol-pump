import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.$transaction([
    prisma.qBSyncLog.deleteMany(),
    prisma.qBConnection.deleteMany(),
    prisma.bifurcation.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.saleItem.deleteMany(),
    prisma.sale.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.product.deleteMany(),
    prisma.fuelPrice.deleteMany(),
    prisma.meterReading.deleteMany(),
    prisma.shift.deleteMany(),
    prisma.nozzle.deleteMany(),
    prisma.dispensingUnit.deleteMany(),
    prisma.user.deleteMany(),
    prisma.branch.deleteMany(),
  ]);

  // Get or create default organization
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Kuwait Petrol Pump',
        slug: 'kuwait-petrol-pump',
        isActive: true,
      },
    });
  }

  // Create Main Branch
  const mainBranch = await prisma.branch.create({
    data: {
      organizationId: org.id,
      name: 'Main Branch',
      location: 'Kuwait City',
    },
  });

  console.log('✅ Created branch:', mainBranch.name);

  // Create Users
  const hashedPassword = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      username: 'admin',
      email: 'admin@petrolpump.com',
      fullName: 'Admin User',
      passwordHash: hashedPassword,
      role: 'ADMIN',
      branchId: mainBranch.id,
    },
  });

  const manager = await prisma.user.create({
    data: {
      organizationId: org.id,
      username: 'manager',
      email: 'manager@petrolpump.com',
      fullName: 'Manager User',
      passwordHash: hashedPassword,
      role: 'MANAGER',
      branchId: mainBranch.id,
    },
  });

  const cashier = await prisma.user.create({
    data: {
      organizationId: org.id,
      username: 'cashier',
      email: 'cashier@petrolpump.com',
      fullName: 'Cashier User',
      passwordHash: hashedPassword,
      role: 'CASHIER',
      branchId: mainBranch.id,
    },
  });

  const operator = await prisma.user.create({
    data: {
      organizationId: org.id,
      username: 'operator',
      email: 'operator@petrolpump.com',
      fullName: 'Pump Operator',
      passwordHash: hashedPassword,
      role: 'OPERATOR',
      branchId: mainBranch.id,
    },
  });

  const accountant = await prisma.user.create({
    data: {
      organizationId: org.id,
      username: 'accountant',
      email: 'accountant@petrolpump.com',
      fullName: 'Accountant User',
      passwordHash: hashedPassword,
      role: 'ACCOUNTANT',
      branchId: mainBranch.id,
    },
  });

  console.log('✅ Created users:', [admin.username, manager.username, cashier.username, operator.username, accountant.username]);

  // Create 4 Dispensing Units with 6 total nozzles (as per questionnaire)
  const unit1 = await prisma.dispensingUnit.create({
    data: {
      branchId: mainBranch.id,
      unitNumber: 1,
      name: 'Unit 1',
      nozzles: {
        create: [
          { nozzleNumber: 1, fuelType: FuelType.HSD },
          { nozzleNumber: 2, fuelType: FuelType.PMG },
        ],
      },
    },
  });

  const unit2 = await prisma.dispensingUnit.create({
    data: {
      branchId: mainBranch.id,
      unitNumber: 2,
      name: 'Unit 2',
      nozzles: {
        create: [{ nozzleNumber: 1, fuelType: FuelType.HSD }],
      },
    },
  });

  const unit3 = await prisma.dispensingUnit.create({
    data: {
      branchId: mainBranch.id,
      unitNumber: 3,
      name: 'Unit 3',
      nozzles: {
        create: [{ nozzleNumber: 1, fuelType: FuelType.PMG }],
      },
    },
  });

  const unit4 = await prisma.dispensingUnit.create({
    data: {
      branchId: mainBranch.id,
      unitNumber: 4,
      name: 'Unit 4',
      nozzles: {
        create: [
          { nozzleNumber: 1, fuelType: FuelType.PMG },
          { nozzleNumber: 2, fuelType: FuelType.PMG },
        ],
      },
    },
  });

  console.log('✅ Created 4 dispensing units with 6 total nozzles');

  // Create Fuel Prices (from questionnaire)
  await prisma.fuelPrice.createMany({
    data: [
      {
        fuelType: FuelType.PMG,
        price: 321.17,
        effectiveFrom: new Date('2026-03-01'),
        updatedBy: admin.id,
        updatedByName: admin.name,
        reason: 'Government announcement',
      },
      {
        fuelType: FuelType.HSD,
        price: 335.86,
        effectiveFrom: new Date('2026-03-01'),
        updatedBy: admin.id,
        updatedByName: admin.name,
        reason: 'Government announcement',
      },
    ],
  });

  console.log('✅ Created fuel prices: PMG=321.17, HSD=335.86');

  // Create Sample Customers
  const customers = await prisma.customer.createMany({
    data: [
      {
        name: 'XYZ Transport Company',
        phone: '+965 9876 5432',
        email: 'xyz@transport.com',
        vehicleNumber: 'ABC-1234',
        creditLimit: 50000,
        creditTermDays: 30,
      },
      {
        name: 'ABC Logistics',
        phone: '+965 8765 4321',
        vehicleNumber: 'DEF-5678',
        creditLimit: 30000,
        creditTermDays: 15,
      },
      {
        name: 'Quick Delivery Services',
        phone: '+965 7654 3210',
        vehicleNumber: 'GHI-9012',
        creditLimit: 20000,
        creditTermDays: 30,
      },
    ],
  });

  console.log('✅ Created 3 sample customers');

  // Create Sample Products (Non-fuel items)
  await prisma.product.createMany({
    data: [
      {
        name: 'Engine Oil - 5W30',
        sku: 'OIL-5W30-4L',
        category: 'Engine Oil',
        barcode: '8901234567890',
        unitPrice: 450.0,
        costPrice: 350.0,
        stockQuantity: 50,
        reorderPoint: 10,
        unit: 'liter',
      },
      {
        name: 'Oil Filter',
        sku: 'FILTER-OIL-001',
        category: 'Filters',
        barcode: '8901234567891',
        unitPrice: 250.0,
        costPrice: 180.0,
        stockQuantity: 100,
        reorderPoint: 20,
        unit: 'pcs',
      },
      {
        name: 'Air Filter',
        sku: 'FILTER-AIR-001',
        category: 'Filters',
        barcode: '8901234567892',
        unitPrice: 180.0,
        costPrice: 130.0,
        stockQuantity: 80,
        reorderPoint: 15,
        unit: 'pcs',
      },
      {
        name: 'Windshield Washer Fluid',
        sku: 'WASH-FLUID-2L',
        category: 'Car Care',
        barcode: '8901234567893',
        unitPrice: 120.0,
        costPrice: 80.0,
        stockQuantity: 200,
        reorderPoint: 30,
        unit: 'liter',
      },
      {
        name: 'Coolant',
        sku: 'COOLANT-5L',
        category: 'Engine Care',
        barcode: '8901234567894',
        unitPrice: 350.0,
        costPrice: 250.0,
        stockQuantity: 60,
        reorderPoint: 12,
        unit: 'liter',
      },
    ],
  });

  console.log('✅ Created 5 sample products');

  console.log('');
  console.log('🎉 Seeding completed!');
  console.log('');
  console.log('📝 Demo Credentials:');
  console.log('Username: admin | Password: password123');
  console.log('Username: manager | Password: password123');
  console.log('Username: cashier | Password: password123');
  console.log('Username: operator | Password: password123');
  console.log('Username: accountant | Password: password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
