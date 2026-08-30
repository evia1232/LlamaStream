import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@llamastream.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log('Admin user already exists, skipping seed.');
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.user.create({
    data: {
      email: adminEmail,
      username: adminUsername,
      passwordHash,
      displayName: 'Administrator',
      role: 'ADMIN',
      language: 'he',
    },
  });

  console.log(`Admin user created: ${adminEmail}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
