import { execSync } from 'child_process';

/**
 * Applies migrations to the dedicated test database (non-destructive `migrate deploy`).
 * Tests isolate themselves by creating uniquely-suffixed companies, so no reset is needed between runs.
 */
export default async function globalSetup() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://fintrack:fintrack@localhost:5432/fintrack_test?schema=public';
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env, cwd: __dirname + '/..' });
}
