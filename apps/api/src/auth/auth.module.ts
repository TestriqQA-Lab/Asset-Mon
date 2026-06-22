import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaTicketService } from '../common/mfa/mfa-ticket.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: Number(process.env.JWT_ACCESS_TTL || 900) },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, MfaTicketService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
