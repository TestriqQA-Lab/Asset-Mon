import {
  BadRequestException, Controller, Delete, Get, Injectable, Module, NotFoundException,
  Param, Post, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor, MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';

const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.txt', '.csv', '.doc', '.docx', '.xls', '.xlsx']);

// Defence-in-depth deny list: even if a future change widens ALLOWED_EXT or
// someone double-extends a filename (`invoice.docx.html`), these will be
// rejected before we touch the disk. Anything in here either renders as HTML,
// is treated as code by the browser, or is a known polyglot vector.
const DENY_EXT = new Set([
  '.html', '.htm', '.xhtml', '.xht', '.xml', '.mhtml', '.mht',
  '.svg', '.svgz',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.vbs', '.vbe', '.wsf', '.wsh', '.hta',
  '.exe', '.dll', '.scr', '.bat', '.cmd', '.com', '.ps1', '.sh',
  '.jar', '.class', '.swf', '.apk',
  '.php', '.phtml', '.php3', '.php4', '.php5', '.phar',
  '.asp', '.aspx', '.jsp', '.cgi',
  '.pl', '.py', '.rb',
  '.eml', '.url',
]);

@Injectable()
class AssetAttachmentsService {
  constructor(private readonly ctx: TenantContextService) {}

  list(assetId: string) {
    return this.ctx.prisma().assetAttachment.findMany({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async create(data: { assetId: string; filename: string; url: string; size: number; mimeType: string; kind: string; uploadedById: string }) {
    return this.ctx.prisma().assetAttachment.create({ data });
  }

  async remove(id: string) {
    const att = await this.ctx.prisma().assetAttachment.findUnique({ where: { id } });
    if (!att) throw new NotFoundException();
    await this.ctx.prisma().assetAttachment.delete({ where: { id } });
    // best-effort file cleanup
    try {
      const safe = path.basename(att.url.split('/').pop() || '');
      const p = path.join(uploadDir, safe);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
    return att;
  }

  /** Look up an attachment in the *current tenant's* DB by its serve URL. */
  findByUrl(url: string) {
    return this.ctx.prisma().assetAttachment.findFirst({ where: { url } });
  }
}

@ApiTags('asset-attachments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets/:assetId/attachments')
class AttachmentsController {
  constructor(private readonly svc: AssetAttachmentsService) {}

  // Manager+ only: attachments carry invoices/receipts/warranty & contract docs plus
  // uploader emails — exactly the financial/PII data the EMPLOYEE asset view withholds.
  @Get()
  @Roles('ADMIN', 'ASSET_MANAGER')
  async list(@Param('assetId') assetId: string) {
    if (!UUID_RE.test(assetId)) throw new BadRequestException('Invalid id');
    return this.svc.list(assetId);
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER')
  @Throttle({ short: { limit: 6, ttl: 60_000 }, medium: { limit: 50, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => {
        const original = (file.originalname || '').toLowerCase();
        // Reject *any* double extension that includes a deny-listed token —
        // e.g. `invoice.html.pdf` is denied even though the trailing ext is
        // `.pdf`, because some legacy IIS configurations execute the
        // intermediate extension.
        for (const bad of DENY_EXT) {
          if (original.endsWith(bad) || original.includes(bad + '.')) {
            return cb(new Error('File type not allowed') as any, '');
          }
        }
        const ext = path.extname(original);
        const safeExt = ALLOWED_EXT.has(ext) ? ext : '.bin';
        cb(null, 'att-' + crypto.randomBytes(16).toString('hex') + safeExt);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  }))
  async upload(
    @Param('assetId') assetId: string,
    @UploadedFile() file: any,
    @CurrentUser('sub') uid: string,
  ) {
    if (!UUID_RE.test(assetId)) throw new BadRequestException('Invalid id');
    if (!file) throw new BadRequestException('No file uploaded');
    const reject = (msg: string) => { try { fs.unlinkSync(file.path); } catch {} throw new BadRequestException(msg); };
    const ext = path.extname(file.filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) reject('Unsupported file type');

    // Magic-byte verification for the high-risk types.
    const fd = fs.openSync(file.path, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isGif  = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45;
    const isPdf  = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

    if (['.png','.jpg','.jpeg','.webp','.gif'].includes(ext) && !(isPng || isJpeg || isGif || isWebp)) {
      reject('File extension does not match its content');
    }
    if (ext === '.pdf' && !isPdf) reject('Not a valid PDF');
    // Office docs and txt/csv are accepted without magic-byte (they have many valid prefixes), but bounded size.

    const kind = ['.png','.jpg','.jpeg','.webp','.gif'].includes(ext) ? 'photo'
      : ext === '.pdf' ? 'document'
      : 'other';

    const url = `/api/asset-attachments/file/${file.filename}`;
    return this.svc.create({
      assetId,
      filename: file.originalname || file.filename,
      url, size: file.size, mimeType: file.mimetype || 'application/octet-stream',
      kind, uploadedById: uid,
    });
  }
}

@ApiTags('asset-attachments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('asset-attachments')
class AttachmentsAdminController {
  constructor(private readonly svc: AssetAttachmentsService) {}

  @Delete(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  remove(@Param('id') id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestException('Invalid id');
    return this.svc.remove(id);
  }

  // Auth-protected file fetch — manager+ only (attachments hold invoices/receipts/
  // contracts the EMPLOYEE asset view deliberately withholds) AND verified to belong
  // to the current tenant.
  @Get('file/:name')
  @Roles('ADMIN', 'ASSET_MANAGER')
  async serve(@Param('name') name: string, @Res() res: Response) {
    const safe = path.basename(name);
    if (!/^att-[0-9a-f]{32}\.[a-z0-9]{1,5}$/i.test(safe)) {
      res.status(400).send('Invalid file name');
      return;
    }

    // Authoritative tenant check: only return a file whose URL is recorded in the
    // current tenant's database. Cross-tenant URL reuse therefore yields 404.
    const url = `/api/asset-attachments/file/${safe}`;
    const own = await this.svc.findByUrl(url);
    if (!own) { res.status(404).send('Not found'); return; }

    const p = path.join(uploadDir, safe);
    const resolved = path.resolve(p);
    if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) {
      res.status(400).send('Invalid path');
      return;
    }
    if (!fs.existsSync(resolved)) { res.status(404).send('Not found'); return; }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // Only inline-render the types we can actually display safely. Office docs,
    // CSV and text get forced to attachment so the browser never treats them as
    // navigable resources. (PDFs and images are fine inline because of the
    // sandbox CSP above + nosniff.)
    const inlineExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf']);
    const disp = inlineExt.has(path.extname(safe).toLowerCase()) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disp}; filename="${safe}"`);
    res.sendFile(resolved);
  }
}

@Module({
  imports: [MulterModule.register({})],
  controllers: [AttachmentsController, AttachmentsAdminController],
  providers: [AssetAttachmentsService],
  exports: [AssetAttachmentsService],
})
export class AssetAttachmentsModule {}
