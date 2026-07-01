import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { DataQualityService } from './data-quality.service';

// Read-only. Manager+ only (the samples surface asset tags / ticket titles), and
// gated by the per-tenant nav matrix (@RequireNav) like the audit log.
@ApiTags('data-quality')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)
@RequireNav('data-quality')
@Roles('ADMIN', 'ASSET_MANAGER')
@Controller('data-quality')
export class DataQualityController {
  constructor(private readonly svc: DataQualityService) {}

  @Get()
  issues() { return this.svc.issues(); }
}
