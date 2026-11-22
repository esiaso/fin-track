import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { buildOpenApi, configureApp } from '../src/bootstrap';

/** Writes docs/openapi.json without needing Redis (queue disabled). Requires DATABASE_URL reachable. */
async function main() {
  const app = await NestFactory.create(AppModule.register({ queue: false }), { logger: false });
  configureApp(app);
  const doc = buildOpenApi(app);
  const out = join(__dirname, '../../../docs/openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths).length} paths)`);
  await app.close();
}
main();
