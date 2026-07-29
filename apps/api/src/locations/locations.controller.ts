import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { LocationsService } from './locations.service';

const TYPES = ['BUILDING', 'FLOOR', 'ROOM', 'DESK'] as const;

class CreateLocationDto {
  @IsString() @MinLength(1) name: string;
  @IsEnum(TYPES) type: typeof TYPES[number];
  @IsOptional() @IsString() parentId?: string | null;
}
class UpdateLocationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(TYPES) type?: typeof TYPES[number];
  @IsOptional() @IsString() parentId?: string | null;
}

@ApiTags('locations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('locations')
export class LocationsController {
  constructor(private readonly svc: LocationsService) {}

  // Location was removed from the product UI and is not part of the employee asset
  // view, so these remain for managers and integrations only.
  @Get()
  @Roles('ADMIN', 'ASSET_MANAGER')
  list() {
    return this.svc.list();
  }

  @Get('tree')
  @Roles('ADMIN', 'ASSET_MANAGER')
  tree() {
    return this.svc.tree();
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreateLocationDto) {
    return this.svc.create(dto as any);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.svc.update(id, dto as any);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
