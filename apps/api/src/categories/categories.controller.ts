import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CategoriesService } from './categories.service';

const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const CATEGORY_TYPES = ['ASSET', 'ACCESSORY', 'LICENSE'] as const;
// imageUrl may only ever be one of OUR uploaded image paths (or null). This blocks
// storing an arbitrary external URL that would render as an <img src> for every viewer.
const IMAGE_URL_RE = /^\/api\/categories\/image\/category-[0-9a-f]{24}\.[a-z0-9]{1,5}$/;

class CreateCategoryDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() customFields?: any[];
  @IsOptional() @IsIn(CATEGORY_TYPES as readonly string[]) type?: string;
  @IsOptional() @Matches(IMAGE_URL_RE, { message: 'imageUrl must be an uploaded category image path' }) imageUrl?: string;
}
class UpdateCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() customFields?: any[];
  @IsOptional() @IsIn(CATEGORY_TYPES as readonly string[]) type?: string;
  // Allow one of our uploaded image paths, or null to clear the image.
  @IsOptional() @ValidateIf((o) => o.imageUrl !== null) @Matches(IMAGE_URL_RE, { message: 'imageUrl must be an uploaded category image path' }) imageUrl?: string | null;
}

@ApiTags('categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Get() list() { return this.svc.list(); }

  // Upload a category image → returns { url }. Declared before @Get(':id') isn't
  // needed (POST vs GET), but keep the write routes grouped.
  @Post('image')
  @Roles('ADMIN', 'ASSET_MANAGER')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => {
        const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
        let ext = path.extname(file.originalname || '').toLowerCase();
        if (!allowed.has(ext)) ext = '.bin';
        cb(null, 'category-' + crypto.randomBytes(12).toString('hex') + ext);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(png|jpe?g|webp)$/i.test(file.mimetype || '');
      cb(ok ? null : new Error('Only PNG, JPEG or WebP images allowed'), ok);
    },
  }))
  async uploadImage(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    // Verify magic bytes so a renamed non-image can't slip through the mimetype check.
    const fd = fs.openSync(file.path, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45;
    if (!(isPng || isJpeg || isWebp)) {
      try { fs.unlinkSync(file.path); } catch {}
      throw new BadRequestException('Uploaded file is not a valid image');
    }
    return { url: `/api/categories/image/${file.filename}` };
  }

  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post() @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreateCategoryDto) { return this.svc.create(dto as any); }

  @Patch(':id') @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) { return this.svc.update(id, dto as any); }

  @Delete(':id') @Roles('ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

// Public sub-controller so the image is reachable from an <img> tag without auth.
// Filenames are 24 random hex chars (unguessable); we serve only files that match
// that pattern from the upload dir. (A signed-URL scheme like the asset-image route
// could be added later if per-tenant scoping of category icons is ever required.)
@ApiTags('categories')
@Controller('categories/image')
export class CategoryImagePublicController {
  @Get(':name')
  serve(@Param('name') name: string, @Res() res: Response) {
    const safe = path.basename(name);
    if (!/^category-[0-9a-f]{24}\.[a-z0-9]{1,5}$/i.test(safe)) {
      res.status(400).send('Invalid file name');
      return;
    }
    const resolved = path.resolve(uploadDir, safe);
    if (!resolved.startsWith(path.resolve(uploadDir) + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).send('Not found');
      return;
    }
    // Match the logo/asset-image serve hardening: never sniff, never active content, always inline.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    res.sendFile(resolved);
  }
}
