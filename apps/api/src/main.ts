import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './bootstrap';

async function main() {
  const app = await NestFactory.create(AppModule.register({ queue: true }), { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  configureApp(app);
  SwaggerModule.setup('api/docs', app, buildOpenApi(app));
  await app.listen(Number(process.env.API_PORT ?? 4000));
}
main();
