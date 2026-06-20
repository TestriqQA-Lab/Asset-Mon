import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CategoriesService } from './categories.service';

class CreateCategoryDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() customFields?: any[];
}
class UpdateCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() customFields?: any[];
}

@ApiTags('categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post() @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreateCategoryDto) { return this.svc.create(dto); }

  @Patch(':id') @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) { return this.svc.update(id, dto); }

  @Delete(':id') @Roles('ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
