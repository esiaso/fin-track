process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://fintrack:fintrack@localhost:5432/fintrack_test?schema=public';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_ISSUER = 'fintrack';
process.env.INTEGRATION_SECRET_CLINITRACK = 'clini-test-secret';
process.env.INBOX_MAX_ATTEMPTS = '3';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.INTEGRATION_SECRET_SUPPLYTRACK = 'supply-test-secret';
