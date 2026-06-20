import { Global, Module } from '@nestjs/common';
import { CatalogPrismaService } from './catalog-prisma.service';

@Global()
@Module({
  providers: [CatalogPrismaService],
  exports: [CatalogPrismaService],
})
export class CatalogModule {}
