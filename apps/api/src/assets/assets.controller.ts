import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as QRCode from 'qrcode';
import { parse } from 'csv-parse/sync';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { AssetsService } from './assets.service';
import { LifecycleService } from './lifecycle.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { GlobalPrismaService } from '../tenancy/global-prisma.service';
import { CreateAssetDto, UpdateAssetDto, ListAssetsQueryDto, CheckoutDto, BulkIdsDto, BulkUpdateDto } from './dto';
import { signFileToken, verifySignedFileToken } from '../common/signed-url';

// Pre-rename AssetStatus values → current ones, so a CSV exported before the
// status rename still imports without per-row enum errors.
const LEGACY_STATUS_MAP: Record<string, string> = {
  IN_STOCK: 'AVAILABLE', IN_REPAIR: 'OUT_OF_SERVICE', RETIRED: 'ARCHIVED', LOST: 'LOST_STOLEN',
};

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)
@RequireNav('assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly svc: AssetsService,
    private readonly lifecycle: LifecycleService,
    private readonly ctx: TenantContextService,
  ) {}

  @Get()
  list(@Query() q: ListAssetsQueryDto) {
    return this.svc.list({
      ...q,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      onlyTopLevel: q.onlyTopLevel === '1' || q.onlyTopLevel === 'true',
    });
  }

  @Get('export.csv')
  @Roles('ADMIN', 'ASSET_MANAGER')
  async exportCsv(@Res() res: Response) {
    const { items } = await this.svc.list({ pageSize: 10000 });
    const head = ['assetTag','name','serialNumber','model','status','category','location','department','vendor','purchaseDate','purchaseCost','warrantyEnd','notes'];
    const rows = items.map((a: any) => [
      a.assetTag, a.name, a.serialNumber || '', a.model || '', a.status,
      a.category?.name || '', a.location?.name || '', a.department?.name || '', a.vendor?.name || '',
      a.purchaseDate ? a.purchaseDate.toISOString().slice(0, 10) : '',
      a.purchaseCost ?? '',
      a.warrantyEnd ? a.warrantyEnd.toISOString().slice(0, 10) : '',
      (a.notes || '').replace(/\n/g, ' '),
    ]);
    const csv = [head, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="assets.csv"');
    res.send(csv);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Get(':id/qr')
  async qr(@Param('id') id: string, @Res() res: Response) {
    const asset = await this.svc.get(id);
    const payload = JSON.stringify({ t: 'assetmon', tag: asset.assetTag, id: asset.id });
    const png = await QRCode.toBuffer(payload, { width: 400, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }

  @Get(':id/audit')
  @Roles('ADMIN', 'ASSET_MANAGER')
  async audit(@Param('id') id: string) {
    const db = this.ctx.prisma();
    return db.auditLog.findMany({
      where: { assetId: id },
      orderBy: { createdAt: 'desc' },
      include: { performedBy: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() body: CreateAssetDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(body, uid);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() body: UpdateAssetDto, @CurrentUser('sub') uid: string) {
    return this.svc.update(id, body, uid);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  remove(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.remove(id, uid);
  }

  @Post('bulk/update')
  @Roles('ADMIN', 'ASSET_MANAGER')
  bulkUpdate(@Body() body: BulkUpdateDto, @CurrentUser('sub') uid: string) {
    return this.svc.bulkUpdate(body.ids, body.patch || {}, uid);
  }

  @Post('bulk/delete')
  @Roles('ADMIN')
  bulkDelete(@Body() body: BulkIdsDto, @CurrentUser('sub') uid: string) {
    return this.svc.bulkDelete(body.ids, uid);
  }

  @Post(':id/checkout')
  @Roles('ADMIN', 'ASSET_MANAGER')
  checkout(@Param('id') id: string, @Body() body: CheckoutDto, @CurrentUser('sub') uid: string) {
    return this.lifecycle.checkout(id, body.userId, body.dueAt || null, uid);
  }

  @Post(':id/checkin')
  @Roles('ADMIN', 'ASSET_MANAGER')
  checkin(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.lifecycle.checkin(id, uid);
  }

  @Post(':id/photo')
  @Roles('ADMIN', 'ASSET_MANAGER')
  @UseInterceptors(FileInterceptor('file', {
    // Bound the upload — the module-level limit only applies if no per-route options are given.
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(jpe?g|png|webp|gif|heic)$/i.test(file.mimetype || '');
      cb(ok ? null : new Error('Only image files allowed'), ok);
    },
  }))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @CurrentUser('sub') uid: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    // Verify content by magic bytes — content-type header is untrusted
    const fd = fs.openSync(file.path, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45;
    if (!(isPng || isJpeg || isGif || isWebp)) {
      try { fs.unlinkSync(file.path); } catch {}
      throw new BadRequestException('Uploaded file is not a valid image');
    }
    const photoUrl = `/api/assets/files/${file.filename}`;
    await this.svc.update(id, { photoUrl }, uid);
    return { ok: true, photoUrl };
  }

  @Post('import')
  @Roles('ADMIN', 'ASSET_MANAGER')
  @UseInterceptors(FileInterceptor('file', {
    // Override the module-level "images only" filter so CSV uploads actually pass.
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || '').toLowerCase();
      const name = (file.originalname || '').toLowerCase();
      const ok = /(csv|excel|spreadsheet|text\/plain)/.test(mime) || /\.csv$/i.test(name);
      cb(ok ? null : new Error('Only CSV files allowed'), ok);
    },
  }))
  async importCsv(@UploadedFile() file: any, @CurrentUser('sub') uid: string) {
    if (!file) throw new BadRequestException('No file uploaded');
    const buf = fs.readFileSync(file.path);
    let records: any[];
    try {
      records = parse(buf, { columns: true, skip_empty_lines: true, trim: true });
    } catch (e: any) {
      fs.unlink(file.path, () => {});
      throw new BadRequestException(`CSV parse error: ${e.message}`);
    }
    if (records.length === 0) {
      fs.unlink(file.path, () => {});
      throw new BadRequestException('CSV contains no rows');
    }
    if (records.length > 5000) {
      fs.unlink(file.path, () => {});
      throw new BadRequestException('CSV exceeds 5000-row limit');
    }

    const db = this.ctx.prisma();
    const cats = new Map<string, any>((await db.category.findMany()).map((c: any) => [c.name.toLowerCase(), c]));
    const locs = new Map<string, any>((await db.location.findMany()).map((l: any) => [l.name.toLowerCase(), l]));
    const depts = new Map<string, any>((await db.department.findMany()).map((d: any) => [d.name.toLowerCase(), d]));

    // Single up-front billing check covering the whole batch.
    if (this.ctx.tenantId) {
      await this.svc.assertCanAddAssets(records.length);
    }

    const parseDate = (label: string, v: any): Date | null | string => {
      if (v == null || v === '') return null;
      const d = new Date(v);
      if (isNaN(d.getTime())) return `Invalid ${label} "${v}"`;
      return d;
    };
    const parseNum = (label: string, v: any): number | null | string => {
      if (v == null || v === '') return null;
      const n = Number(v);
      if (isNaN(n)) return `Invalid ${label} "${v}"`;
      return n;
    };

    let created = 0;
    const errors: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      try {
        if (!r.name) { errors.push(`Row ${i + 2}: missing required field "name"`); continue; }
        const cat = cats.get(String(r.category || '').toLowerCase());
        if (!cat) { errors.push(`Row ${i + 2}: unknown category "${r.category}"`); continue; }
        const loc = r.location ? locs.get(String(r.location).toLowerCase()) : null;
        const dep = r.department ? depts.get(String(r.department).toLowerCase()) : null;

        const pd = parseDate('purchaseDate', r.purchaseDate);
        if (typeof pd === 'string') { errors.push(`Row ${i + 2}: ${pd}`); continue; }
        const we = parseDate('warrantyEnd', r.warrantyEnd);
        if (typeof we === 'string') { errors.push(`Row ${i + 2}: ${we}`); continue; }
        const pc = parseNum('purchaseCost', r.purchaseCost);
        if (typeof pc === 'string') { errors.push(`Row ${i + 2}: ${pc}`); continue; }

        await this.svc.create({
          name: r.name,
          assetTag: r.assetTag || undefined,
          serialNumber: r.serialNumber || null,
          model: r.model || null,
          // Map pre-rename status values so old exports still import cleanly.
          status: LEGACY_STATUS_MAP[String(r.status || '').trim().toUpperCase()] || r.status || 'AVAILABLE',
          categoryId: cat.id,
          locationId: loc?.id || null,
          departmentId: dep?.id || null,
          purchaseDate: pd ? (pd as Date).toISOString() : null,
          purchaseCost: pc as number | null,
          warrantyEnd: we ? (we as Date).toISOString() : null,
          notes: r.notes || null,
        }, uid, { skipBillingCheck: true });
        created++;
      } catch (e: any) {
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    }
    fs.unlink(file.path, () => {});
    return { ok: true, created, errors };
  }

  // Auth-protected file fetch — also returns a fresh signed URL for the same file
  // so the dashboard can use it in <img> tags without sending its Bearer header.
  @Get('files/:name')
  async serve(@Param('name') name: string, @Res() res: Response, @CurrentUser('tid') tid: string) {
    const safe = path.basename(name);
    if (!/^[a-f0-9]{32}\.[a-z0-9]{1,5}$/i.test(safe)) { res.status(400).send('Invalid file name'); return; }
    // Confirm the file is referenced by an asset in the *current* tenant DB.
    const owned = await this.ctx.prisma().asset.findFirst({
      where: { photoUrl: { endsWith: '/' + safe } }, select: { id: true },
    });
    if (!owned) { res.status(404).send('Not found'); return; }

    const dir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
    const p = path.join(dir, safe);
    const resolved = path.resolve(p);
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) { res.status(400).send('Invalid path'); return; }
    if (!fs.existsSync(resolved)) { res.status(404).send('Not found'); return; }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    res.sendFile(resolved);
  }

  // Issue a short-lived signed URL the front-end can drop straight into an <img> tag.
  @Get(':id/photo-url')
  async photoUrl(@Param('id') id: string, @CurrentUser('tid') tid: string) {
    // Run through `svc.get` so EMPLOYEE-self / dept-scope enforcement applies
    // here too — otherwise callers could mint signed URLs for assets they're
    // not allowed to see in the list view.
    const a = await this.svc.get(id);
    if (!a?.photoUrl) return { url: null };
    const filename = path.basename(a.photoUrl);
    const token = signFileToken(filename, tid, 3600);
    return { url: `/api/assets/file-public/${filename}?sig=${encodeURIComponent(token)}` };
  }
}

// Public sub-controller so signed photo URLs work in <img> tags (browsers do not
// attach Authorization to subresource requests). The signed URL embeds the
// tenantId and an expiry; the resolver actively enforces that the file is
// actually referenced by an asset in *that* tenant's DB. A signed URL minted
// by tenant A therefore cannot serve tenant B's file even if the random
// 32-hex filename were guessed.
@ApiTags('assets-public')
@Controller('assets/file-public')
export class AssetsPublicFileController {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  @Get(':name')
  async serve(@Param('name') name: string, @Query('sig') sig: string, @Res() res: Response) {
    const safe = path.basename(name);
    if (!/^[a-f0-9]{32}\.[a-z0-9]{1,5}$/i.test(safe)) { res.status(400).send('Invalid file name'); return; }
    if (!sig) { res.status(403).send('Invalid or expired signature'); return; }
    const ver = verifySignedFileToken(sig, safe);
    if (!ver) { res.status(403).send('Invalid or expired signature'); return; }

    // Resolve the signed tenant against the catalog. We then check that an
    // asset in *that* tenant DB actually references the file. Without this
    // step the tenantId embedded in the signed URL would be decorative — any
    // valid signature would serve any file.
    const tenant = await this.globalPrisma.tenant.findUnique({
      where: { id: ver.tenantId },
      select: { id: true, status: true },
    }).catch(() => null);
    if (!tenant || tenant.status === 'DELETED') {
      res.status(404).send('Not found'); return;
    }
    try {
      const db = this.globalPrisma;
      const owned = await db.asset.findFirst({
        where: { tenantId: tenant.id, photoUrl: { endsWith: '/' + safe } }, select: { id: true },
      });
      if (!owned) { res.status(404).send('Not found'); return; }
    } catch {
      res.status(404).send('Not found'); return;
    }

    const dir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
    const p = path.join(dir, safe);
    const resolved = path.resolve(p);
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) { res.status(400).send('Invalid path'); return; }
    if (!fs.existsSync(resolved)) { res.status(404).send('Not found'); return; }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    res.sendFile(resolved);
  }
}

function escapeCsv(v: any): string {
  let s = v == null ? '' : String(v);
  // Formula-injection defence: cells starting with one of these are interpreted as a
  // formula in Excel / Google Sheets. Prepend a single quote so they render as text.
  // Applies to every column — including free-text fields like name / notes / serialNumber
  // that an attacker can plant via the API and later get an admin to export.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
