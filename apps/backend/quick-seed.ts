import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function quickSeed() {
  console.log('🌱 Quick seeding for login test...');

  // Get or create organization
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Kuwait Petrol Pump',
        currency: 'KWD',
        timezone: 'Asia/Kuwait',
      },
    });
    console.log('✅ Created organization:', org.name);
  }

  // Get or create branch
  let branch = await prisma.branch.findFirst({
    where: { organizationId: org.id },
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Main Branch',
        location: 'Kuwait City',
      },
    });
    console.log('✅ Created branch:', branch.name);
  }

  // Create users if they don't exist
  const hashedPassword = await bcrypt.hash('password123', 10);

  const roles = ['admin', 'manager', 'cashier', 'operator', 'accountant'];

  for (const role of roles) {
    const existingUser = await prisma.user.findFirst({
      where: {
        organizationId: org.id,
        username: role,
      },
    });

    if (!existingUser) {
      await prisma.user.create({
        data: {
          organizationId: org.id,
          username: role,
          email: `${role}@petrolpump.com`,
          fullName: `${role.charAt(0).toUpperCase() + role.slice(1)} User`,
          passwordHash: hashedPassword,
          role: role.toUpperCase(),
          branchId: branch.id,
        },
      });
      console.log(`✅ Created user: ${role}`);
    } else {
      console.log(`⏭️  User ${role} already exists`);
    }
  }

  console.log('');
  console.log('🎉 Quick seed completed!');
  console.log('');
  console.log('📝 Demo Credentials:');
  console.log('Username: admin | Password: password123');
  console.log('Username: operator | Password: password123');
  console.log('Username: cashier | Password: password123');
}

quickSeed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
