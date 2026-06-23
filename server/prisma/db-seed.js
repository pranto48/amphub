import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[DB-SEED] Seeding Prisma database...');

  // Seed default policy row in AdminPermissions
  await prisma.adminPermission.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      autoDenyOutsideBusinessHours: false,
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      requireTwoStepSensitiveNodes: false,
      sensitiveNodeIds: '[]',
      maxSessionDurationByRole: '{"user": 30, "admin": 120}',
      dailyDeploymentEnabled: false,
      dailyDeploymentTime: '02:00',
    },
  });

  // Seed custom admin user: admin@amphub.com / Interst0ff
  // bcrypt hash of "Interst0ff"
  const adminHash = '$2b$10$3UFknKDg56eCZn2oKJeE3OXBC6UFn2kOhw8c9zUdobRIXI3tEgB96';
  await prisma.user.upsert({
    where: { email: 'admin@amphub.com' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'admin@amphub.com',
      passwordHash: adminHash,
      displayName: 'Admin',
      role: 'admin',
    },
  });

  // Seed default arif admin user: mail@arifmahmud.com / Interst0ff
  await prisma.user.upsert({
    where: { email: 'mail@arifmahmud.com' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000006',
      email: 'mail@arifmahmud.com',
      passwordHash: adminHash,
      displayName: 'Arif Mahmud',
      role: 'admin',
    },
  });

  // Seed bootstrap admin user if BOOTSTRAP_DEFAULT_ADMIN is true
  const bootstrapDefaultAdmin = String(process.env.BOOTSTRAP_DEFAULT_ADMIN || 'false').toLowerCase() === 'true';
  if (bootstrapDefaultAdmin) {
    // bcrypt hash of "password"
    const bootstrapHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    await prisma.user.upsert({
      where: { email: 'admin@admin.com' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'admin@admin.com',
        passwordHash: bootstrapHash,
        displayName: 'Administrator',
        role: 'admin',
      },
    });
    console.log('[DB-SEED] Seeded bootstrap admin user (admin@admin.com).');
  }

  // Delete existing dummy desktop nodes if they exist
  await prisma.desktopNode.deleteMany({
    where: {
      id: {
        in: [
          '00000000-0000-0000-0000-000000000003',
          '00000000-0000-0000-0000-000000000004',
          '00000000-0000-0000-0000-000000000005',
        ],
      },
    },
  });
  console.log('[DB-SEED] Cleaned up default demo desktop nodes.');

  console.log('[DB-SEED] Seeding complete.');
}

main()
  .catch((e) => {
    console.error('[DB-SEED] Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
