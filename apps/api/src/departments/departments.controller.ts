import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DepartmentsService } from './departments.service';

class CreateDepartmentDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() costCenter?: string;
}
class UpdateDepartmentDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() costCenter?: string;
}

@ApiTags('departments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly svc: DepartmentsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreateDepartmentDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
