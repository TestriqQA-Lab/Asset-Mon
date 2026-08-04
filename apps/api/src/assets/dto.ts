import { IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

const STATUSES = ['PENDING', 'AVAILABLE', 'ASSIGNED', 'OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED'] as const;
const DEP_METHODS = ['NONE', 'STRAIGHT_LINE', 'DECLINING_BALANCE'] as const;

export class CreateAssetDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(64) assetTag?: string;
  @IsOptional() @IsString() @MaxLength(128) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(128) model?: string;
  @IsOptional() @IsIn(STATUSES) status?: typeof STATUSES[number];
  @IsOptional() @IsUUID() locationId?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsUUID() vendorId?: string | null;
  @IsOptional() @IsISO8601() purchaseDate?: string;
  @IsOptional() @IsNumber() purchaseCost?: number;
  @IsOptional() @IsISO8601() warrantyEnd?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(128) orderNumber?: string;
  @IsOptional() @IsBoolean() requestable?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, any>;
  @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @IsOptional() @IsIn(DEP_METHODS) depreciationMethod?: typeof DEP_METHODS[number];
  @IsOptional() @IsNumber() salvageValue?: number;
  @IsOptional() @IsInt() @Min(1) @Max(600) usefulLifeMonths?: number;
  @IsOptional() @IsISO8601() depreciationStart?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsUUID() statusDefId?: string | null;
}

// IsUUID() rejects empty strings and bare null. Wrap with @ValidateIf so callers can
// still send `null` (to clear an FK) without tripping the UUID validator.
import { ValidateIf } from 'class-validator';

export class UpdateAssetDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(64) assetTag?: string;
  @IsOptional() @IsString() @MaxLength(128) serialNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(128) model?: string | null;
  @IsOptional() @IsIn(STATUSES) status?: typeof STATUSES[number];
  @ValidateIf((_, v) => v != null && v !== '') @IsUUID() categoryId?: string | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsUUID() locationId?: string | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsUUID() departmentId?: string | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsUUID() vendorId?: string | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsISO8601() purchaseDate?: string | null;
  @IsOptional() @IsNumber() purchaseCost?: number | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsISO8601() warrantyEnd?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(128) orderNumber?: string;
  @IsOptional() @IsBoolean() requestable?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, any>;
  @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @IsOptional() @IsIn(DEP_METHODS) depreciationMethod?: typeof DEP_METHODS[number];
  @IsOptional() @IsNumber() salvageValue?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(600) usefulLifeMonths?: number | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsISO8601() depreciationStart?: string | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsUUID() parentId?: string | null;
  @ValidateIf((_, v) => v != null && v !== '') @IsUUID() statusDefId?: string | null;
}

export class ListAssetsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(STATUSES) status?: typeof STATUSES[number];
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsString() onlyTopLevel?: string;
  // Presence of any truthy value narrows the list to the caller's own assets.
  @IsOptional() @IsString() assignedToMe?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

export class CheckoutDto {
  @IsUUID() userId: string;
  @IsOptional() @IsISO8601() dueAt?: string;
}

export class BulkIdsDto {
  @IsArray() @IsUUID('all', { each: true }) ids: string[];
}

export class BulkUpdateDto extends BulkIdsDto {
  @IsOptional() @IsObject() patch?: Record<string, any>;
}
