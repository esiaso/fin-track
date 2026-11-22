import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { seedReference } from './fixtures';

/** Dev seed: demo hospital group, chart of accounts, 2026 periods, users. Prints dev JWTs. */
async function main() {
  const prisma = new PrismaClient();
  if (await prisma.company.findUnique({ where: { code: 'HOSP' } })) {
    console.log('Seed already applied (company HOSP exists).');
    await prisma.$disconnect();
    return;
  }
  const ref = await seedReference(prisma);
  const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? 'change-me-dev-only', signOptions: { issuer: process.env.JWT_ISSUER ?? 'fintrack', expiresIn: '30d' } });
  console.log(`Company ${ref.company.code} = ${ref.company.id}`);
  for (const [name, u] of Object.entries(ref.users)) {
    console.log(`DEV TOKEN ${name}: ${jwt.sign({ sub: u.id, roles: u.roles })}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
