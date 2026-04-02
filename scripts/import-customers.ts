import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const customers = [
  "6222-LES CREATIVE ELECTRONICS",
  "ABDULLAH FLOUR MILLS PVT LTD",
  "ABL Bank Staff",
  "ABUZAR GRINDING MILL (PVT) LIMITED",
  "AL-MUKHTAR FLOUR& GENERAL MILLS",
  "AL FAISAL GOODS TRANSPORT COMPANY",
  "AL HARAM TRANSPORT",
  "AL WAHAB FLOUR MILL",
  "ALI SARWR JAZZ TOWER COMPANY",
  "ALLMED (PVT) LTD",
  "AR FILLING STATION",
  "ARABIA ROLLER FLOUR MILL",
  "ATALFA CO",
  "ATTOCK PUMP",
  "AVANZA HEALTH CARE",
  "Bank Card Receiveable",
  "BARAKA FLOUR MILLS.",
  "BB CHEMPAK INDUSTRIES (PVT) LTD.",
  "BIN RASHEED",
  "BISMILLAH FILLING STATION",
  "BOARD OF MANAGEMENT SIE",
  "CH IBRAHIM PETROL PUMP",
  "CHADUHARY ABDULLAH TRANSPORT CO.",
  "CREATIVE  ELECTRONICS (PVT) LTD.",
  "DANEWAL COACHES",
  "ENFRASHARE JAZZ COMPANY",
  "FINE FIBER COMPANY",
  "G T & D PRIVATE LIMITED",
  "GOLDEN FOODS PVT LTD",
  "GREEN TOURS RENT A CAR",
  "HOEST COMPANY",
  "HORIZON HEALTH CARE (PVT) LTD.",
  "HSD gain/loss",
  "IMPERIAL FLOUR MILL",
  "IMPEX FREIGHT SYSTEM",
  "JAMSHAID KPP-4621",
  "JAWA FOODS RAIWIND",
  "JAZZ TOWER COMPANY",
  "KAMAL ZIMINDAR FLOUR MILL",
  "KANSAI PAINT",
  "LASANI GROUP COMPANY (MUMTAZ SB)",
  "MADINA FILLING STATION",
  "MATRIX",
  "MEHRAN PLASTIC INDUSTIRES (PVT) LTD",
  "MON SALWA FACTORY",
  "NASEER PAPER AND BOARD MILL (PVT) L",
  "NAVEED WAZIR ALI (LPG)",
  "PARK VIEW LEDGER",
  "PERFECT TRANSPORT NETWORK CO",
  "PHARMA SOLE",
  "PMG gain/loss",
  "PROGRESSIVE ENGINEERING CO",
  "PSO Card Receivables",
  "PSO incentives",
  "Rawi Autos",
  "ROSHAN PACKAGES COMPANY",
  "SAMRAH ENTERPRISES",
  "SHAN FOODS (PVT) LTD.",
  "SHMZ LABS & PHARMACEUTICALS (PVT) L",
  "SIX B FOOD INDUSTRIES (PVT) LTD",
  "SUNDAR FLOUR & GENERAL MILLS (PVT)",
  "TAIBA GOODS TRANSPORT COMPANY",
  "TALK PACK COMPANY",
  "THERMOSOLE INDUSTRIES",
  "TOURS (LASANI TOURS)",
  "ULTRA PACK COMPANY",
  "UNITED FILLING STATION",
  "VIEGEN PHARMA (PVT) LTD.",
  "Walk in customer",
  "YOUNAS TRANSPORTER"
];

async function importCustomers() {
  try {
    console.log('Starting customer import...');

    // Get organization and branch
    const organization = await prisma.organization.findFirst();
    if (!organization) {
      throw new Error('No organization found. Please run seed first.');
    }

    const branch = await prisma.branch.findFirst({
      where: { organizationId: organization.id }
    });
    if (!branch) {
      throw new Error('No branch found. Please run seed first.');
    }

    console.log(`Importing ${customers.length} customers to organization: ${organization.name}`);

    // Delete existing demo customers (keep only walk-in if it exists)
    await prisma.customer.deleteMany({
      where: {
        organizationId: organization.id,
        NOT: {
          name: 'Walk in customer'
        }
      }
    });

    // Import customers
    let imported = 0;
    for (const customerName of customers) {
      // Check if customer already exists
      const existing = await prisma.customer.findFirst({
        where: {
          name: customerName,
          organizationId: organization.id
        }
      });

      if (existing) {
        console.log(`  ⏭️  Skipped: ${customerName} (already exists)`);
        continue;
      }

      // Generate default phone (can be updated later)
      const phone = `+92-300-0000000`; // Placeholder

      await prisma.customer.create({
        data: {
          name: customerName,
          phone: phone,
          email: null,
          address: null,
          creditLimit: 0, // Default, can be updated per customer
          currentBalance: 0,
          organizationId: organization.id,
        }
      });

      imported++;
      console.log(`  ✅ Imported: ${customerName}`);
    }

    console.log(`\n✅ Import complete! Imported ${imported} customers.`);
    console.log(`Total customers in database: ${await prisma.customer.count({ where: { organizationId: organization.id } })}`);

  } catch (error) {
    console.error('Error importing customers:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

importCustomers();
