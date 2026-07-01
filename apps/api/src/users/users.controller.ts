import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';

const ROLES = ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'] as const;

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsEnum(ROLES) role: typeof ROLES[number];
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsString() scopedDepartmentId?: string | null;
}
class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsEnum(ROLES) role?: typeof ROLES[number];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsString() scopedDepartmentId?: string | null;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}
class ResetUserMfaDto {
  // The acting admin's OWN password — required only when that admin has MFA
  // enabled (step-up). Optional in the DTO so admins without MFA can omit it.
  @IsOptional() @IsString() password?: string;
}
class OffboardUserDto {
  // Release-only (Slice 6a). deactivate defaults true; password is the acting
  // admin's step-up (only checked when that admin has MFA enabled).
  @IsOptional() @IsBoolean() deactivate?: boolean;
  @IsOptional() @IsString() password?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  // Listing every workspace user — including emails and roles — is a privilege.
  // EMPLOYEE never needs this list (the only EMPLOYEE-facing flow that picks a
  // user is the reservation request, and that one always books for self).
  @Get()
  @Roles('ADMIN', 'ASSET_MANAGER')
  list() {
    return this.svc.list();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: any) {
    return this.svc.create(dto, { id: actor.sub, role: actor.role });
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: any) {
    return this.svc.update(id, dto, { id: actor.sub, role: actor.role });
  }

  // Company-admin recovery: clear a user's MFA so they can re-enroll after
  // losing their email/device. Independent of the password reset above.
  @Post(':id/reset-mfa')
  @Roles('ADMIN')
  resetMfa(@Param('id') id: string, @Body() dto: ResetUserMfaDto, @CurrentUser() actor: any) {
    return this.svc.resetUserMfa(id, { id: actor.sub, role: actor.role }, dto.password);
  }

  // Offboarding (Slice 6a): preview what a user still holds, then deactivate +
  // release it all back to the pool in one audited transaction.
  @Get(':id/offboarding-preview')
  @Roles('ADMIN')
  offboardingPreview(@Param('id') id: string, @CurrentUser() actor: any) {
    return this.svc.getOffboardingPreview(id, { id: actor.sub, role: actor.role });
  }

  @Post(':id/offboard')
  @Roles('ADMIN')
  offboard(@Param('id') id: string, @Body() dto: OffboardUserDto, @CurrentUser() actor: any) {
    return this.svc.offboardUser(id, dto, { id: actor.sub, role: actor.role });
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @CurrentUser() actor: any) {
    return this.svc.remove(id, { id: actor.sub, role: actor.role });
  }
}
