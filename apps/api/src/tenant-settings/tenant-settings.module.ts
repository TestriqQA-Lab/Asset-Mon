import {
  BadRequestException, Body, Controller, Get, Global, Injectable, Module, Param, Patch, Post, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ModuleGuard } from './module.guard';
import { NavPermissionsGuard } from './nav-permissions.guard';
import { diskStorage } from 'multer';
import { FileInterceptor, MulterModule } from '@nestjs/platform-express';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  IsHexColor, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { GlobalPrismaService } from '../tenancy/global-prisma.service';
import {
  DEFAULT_SETTINGS, mergeSettings, MODULE_KEYS,
  PRESET_IDS, THEME_TOKENS,
  CUSTOMISABLE_ROLES, NAV_KEYS, mergePermissions,
  type TenantSettings, type ModuleKey, type ThemeConfig,
  type PresetId, type ThemeToken,
  type TenantPermissions, type CustomisableRole, type NavKey,
} from './tenant-settings.types';

const HEX_RE = /^#[0-9a-f]{6}$/i;
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);

const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

@Injectable()
class TenantSettingsService {
  constructor(private readonly catalog: GlobalPrismaService) {}

  async get(tenantId: string): Promise<TenantSettings> {
    const t = await this.catalog.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    return mergeSettings(t?.settings);
  }

  async update(tenantId: string, patch: Partial<TenantSettings>): Promise<TenantSettings> {
    const current = await this.get(tenantId);
    const next: TenantSettings = {
      modules: { ...current.modules, ...(patch.modules || {}) },
      branding: { ...current.branding, ...(patch.branding || {}) },
      permissions: patch.permissions ?? current.permissions,
    };
    await this.catalog.tenant.update({ where: { id: tenantId }, data: { settings: next as any } });
    return next;
  }

  async setLogo(tenantId: string, url: string | null) {
    const current = await this.get(tenantId);
    const next: TenantSettings = { ...current, branding: { ...current.branding, logoUrl: url } };
    await this.catalog.tenant.update({ where: { id: tenantId }, data: { settings: next as any } });
    return next;
  }

  async setPermissions(tenantId: string, perms: TenantPermissions) {
    const current = await this.get(tenantId);
    const next: TenantSettings = { ...current, permissions: perms };
    await this.catalog.tenant.update({ where: { id: tenantId }, data: { settings: next as any } });
    return next;
  }
}

class UpdateModulesDto {
  @IsObject() modules: Record<string, boolean>;
}

class UpdateThemeDto {
  @IsOptional()
  @IsIn(PRESET_IDS as readonly string[])
  preset?: PresetId;

  // Validated bespoke against THEME_TOKENS in `sanitizeTheme()` — class-validator
  // can't natively type `Record<UnionLiteral, hex>` without a custom decorator,
  // and we want unknown keys silently dropped rather than failing the whole save.
  @IsOptional()
  @IsObject()
  overrides?: Record<string, string>;
}

class UpdateBrandingDto {
  @IsOptional() @IsHexColor() brandColor?: string;
  @IsOptional() @IsString() @MaxLength(64) appName?: string;
  @IsOptional() @ValidateNested() @Type(() => UpdateThemeDto)
  theme?: UpdateThemeDto;
}

function sanitizeTheme(input: UpdateThemeDto | undefined, prev: ThemeConfig): ThemeConfig {
  if (!input) return prev;
  const preset: PresetId = input.preset && (PRESET_IDS as readonly string[]).includes(input.preset)
    ? (input.preset as PresetId)
    : prev.preset;
  // When `overrides` is supplied at all, treat it as the canonical replacement
  // so a "reset to default" PATCH can clear every override in one round-trip.
  if (input.overrides === undefined) return { preset, overrides: prev.overrides };
  if (!input.overrides || typeof input.overrides !== 'object') {
    return { preset, overrides: {} };
  }
  const clean: Partial<Record<ThemeToken, string>> = {};
  for (const t of THEME_TOKENS) {
    const v = input.overrides[t];
    if (isHex(v)) clean[t] = v.toLowerCase();
  }
  return { preset, overrides: clean };
}

@ApiTags('tenant-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)
@Controller('tenant-settings')
class TenantSettingsController {
  constructor(private readonly svc: TenantSettingsService) {}

  // Any authenticated user can read settings (we use it client-side to render the right shell)
  @Get()
  async get(@CurrentUser('tid') tid: string) {
    return this.svc.get(tid);
  }

  @Patch('modules')
  @Roles('ADMIN')
  async updateModules(@CurrentUser('tid') tid: string, @Body() body: UpdateModulesDto) {
    // Only accept known keys
    const accepted: Record<string, boolean> = {};
    for (const k of MODULE_KEYS) {
      if (typeof body.modules?.[k] === 'boolean') accepted[k] = body.modules[k];
    }
    return this.svc.update(tid, { modules: accepted as any });
  }

  @Patch('branding')
  @Roles('ADMIN')
  async updateBranding(@CurrentUser('tid') tid: string, @Body() body: UpdateBrandingDto) {
    const current = await this.svc.get(tid);
    const nextBranding: TenantSettings['branding'] = {
      logoUrl: current.branding.logoUrl, // logo updates flow through /logo, never here
      brandColor: body.brandColor ?? current.branding.brandColor,
      appName: body.appName ?? current.branding.appName,
      theme: sanitizeTheme(body.theme, current.branding.theme),
    };
    return this.svc.update(tid, { branding: nextBranding });
  }

  @Post('logo')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => {
        const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
        let ext = path.extname(file.originalname || '').toLowerCase();
        if (!allowed.has(ext)) ext = '.bin';
        const name = 'logo-' + crypto.randomBytes(12).toString('hex') + ext;
        cb(null, name);
      },
    }),
    limits: { fileSize: 1 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(png|jpe?g|webp|svg\+xml)$/i.test(file.mimetype || '');
      cb(ok ? null : new Error('Only PNG, JPEG, WebP or SVG logos allowed'), ok);
    },
  }))
  async uploadLogo(@CurrentUser('tid') tid: string, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    const reject = (msg: string) => { try { fs.unlinkSync(file.path); } catch {} throw new BadRequestException(msg); };

    if (/\.svg$/i.test(file.filename)) {
      // SVG can carry script + event-handler payloads. We aim for the OWASP
      // SVG Cheat Sheet baseline: reject anything that can execute JS, fetch
      // external resources, declare entities (XXE), or break out of the <svg>
      // element. This is an allow-list-ish blacklist — if a logo legitimately
      // needs scripts or external refs, the answer is "use PNG".
      const txt = fs.readFileSync(file.path, 'utf8');
      const looksLikeSvg = /<svg[\s>]/i.test(txt);
      if (!looksLikeSvg) reject('Not a valid SVG');
      const RISKY = [
        // script-execution vectors
        /<\s*script\b/i,
        /<\s*foreignobject\b/i,
        /<\s*iframe\b/i,
        /<\s*embed\b/i,
        /<\s*object\b/i,
        /<\s*meta\b/i,
        /<\s*link\b/i,
        /\bon[a-z]+\s*=/i,                       // event handlers
        /javascript:/i,
        /vbscript:/i,
        /data:\s*[^,]*script/i,                  // data:text/html;..,<script>
        // CSS-based execution / external fetches
        /expression\s*\(/i,                      // IE CSS expressions
        /\bbehavior\s*:/i,                        // IE behaviors
        /@import\b/i,
        /<\s*style\b[^>]*>[\s\S]*?(@import|url\s*\(|expression)/i,
        // XXE / DTDs / processing instructions
        /<\!ENTITY/i,
        /<\!DOCTYPE/i,
        /<\?xml-stylesheet/i,
        // CDATA can be used to smuggle scripts past naive parsers
        /<\!\[CDATA\[[\s\S]*?(?:script|on[a-z]+\s*=|javascript:)/i,
        // SVG2 dropped the xlink: prefix; catch href / xlink:href with risky schemes
        /\b(?:xlink:)?href\s*=\s*['"]\s*(?:data|javascript|vbscript|file):/i,
        // <use>, <image>, <a> can fetch / navigate to anything via href
        /<\s*(?:use|image|a)\b[^>]*\bhref\s*=/i,
        // animate / set can mutate href to javascript: at runtime
        /<\s*(?:set|animate(?:Transform)?)\b[^>]*\battributeName\s*=\s*['"]?(?:href|xlink:href)/i,
        // explicit script namespace prefix
        /<\s*[a-z]+:script\b/i,
        // some renderers honour <handler> from SVG-T
        /<\s*handler\b/i,
      ];
      if (RISKY.some((r) => r.test(txt))) {
        reject('SVG contains disallowed scripts, event handlers, or external references');
      }
    } else {
      // Raster: verify magic bytes.
      const fd = fs.openSync(file.path, 'r');
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45;
      if (!(isPng || isJpeg || isWebp)) reject('Uploaded file is not a valid image');
    }

    const url = `/api/tenant-settings/logo/${file.filename}`;
    return this.svc.setLogo(tid, url);
  }

  @Post('logo/clear')
  @Roles('ADMIN')
  async clearLogo(@CurrentUser('tid') tid: string) {
    return this.svc.setLogo(tid, null);
  }

  /**
   * Replace the per-role permissions matrix. Body shape:
   *
   *   { "ASSET_MANAGER": { "nav": { "assets": true, ... } },
   *     "EMPLOYEE":      { "nav": { ... } } }
   *
   * Unknown roles / unknown nav keys / non-boolean values are silently dropped
   * (via `mergePermissions`) so a stale client can't poison the matrix.
   * ADMIN entries in the body are ignored — ADMIN always has full access.
   */
  @Patch('permissions')
  @Roles('ADMIN')
  async updatePermissions(@CurrentUser('tid') tid: string, @Body() body: any) {
    const merged = mergePermissions(body);
    return this.svc.setPermissions(tid, merged);
  }

}

// Public sub-controller so the logo file is accessible to <img> tags without auth.
@ApiTags('tenant-settings')
@Controller('tenant-settings/logo')
class TenantLogoPublicController {
  constructor(private readonly catalog: GlobalPrismaService) {}

  @Get(':name')
  async serve(@Param('name') name: string, @Res() res: Response) {
    const safe = path.basename(name);
    // Only allow logo files that follow the random-hex naming the upload route produces.
    if (!/^logo-[0-9a-f]{24}\.[a-z0-9]{1,5}$/i.test(safe)) {
      res.status(400).send('Invalid file name'); return;
    }

    // Authoritative ownership check: only serve a logo whose URL is published
    // by some tenant's settings. Random-but-orphaned files on disk are not served.
    //
    // `path` takes the array form on Postgres. The MySQL connector wanted a JSONPath
    // string instead and rejected the array client-side, before the query was sent —
    // which threw past the 404 below and turned every logo request into a 500. Keep
    // the shape matched to the provider, and keep it un-cast: the `as any` that used
    // to be here was silencing the type error that described exactly that bug.
    const publicUrl = `/api/tenant-settings/logo/${safe}`;
    const owner = await this.catalog.tenant.findFirst({
      where: { settings: { path: ['branding', 'logoUrl'], equals: publicUrl } },
      select: { id: true },
    });
    if (!owner) { res.status(404).send('Not found'); return; }

    const p = path.join(uploadDir, safe);
    const resolved = path.resolve(p);
    if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) {
      res.status(400).send('Invalid path'); return;
    }
    if (!fs.existsSync(resolved)) { res.status(404).send('Not found'); return; }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Defence in depth: SVG can host scripts when rendered as top-level docs.
    // We only ever embed via <img>, but block direct nav anyway.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    res.sendFile(resolved);
  }
}

@Global()
@Module({
  imports: [MulterModule.register({})],
  controllers: [TenantSettingsController, TenantLogoPublicController],
  providers: [TenantSettingsService, ModuleGuard, NavPermissionsGuard],
  exports: [TenantSettingsService, ModuleGuard, NavPermissionsGuard],
})
export class TenantSettingsModule {}
