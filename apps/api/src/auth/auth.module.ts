import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'change-me-dev-only',
      verifyOptions: { issuer: process.env.JWT_ISSUER ?? 'fintrack' },
      signOptions: { issuer: process.env.JWT_ISSUER ?? 'fintrack', expiresIn: '8h' },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
  exports: [JwtModule],
})
export class AuthModule {}
