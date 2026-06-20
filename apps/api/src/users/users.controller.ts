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

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @CurrentUser() actor: any) {
    return this.svc.remove(id, { id: actor.sub, role: actor.role });
  }
}
