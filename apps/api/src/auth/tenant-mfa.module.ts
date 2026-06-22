import { Module } from '@nestjs/common';
import { TenantMfaController } from './tenant-mfa.controller';
import { TenantMfaService } from './tenant-mfa.service';

@Module({
  controllers: [TenantMfaController],
  providers: [TenantMfaService],
  exports: [TenantMfaService],
})
export class TenantMfaModule {}
