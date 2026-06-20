import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AssetsController, AssetsPublicFileController } from './assets.controller';
import { AssetsService } from './assets.service';
import { LifecycleService } from './lifecycle.service';

const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: uploadDir,
        filename: (_req, file, cb) => {
          const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic']);
          let ext = path.extname(file.originalname || '').toLowerCase();
          if (!allowed.has(ext)) ext = '.bin';
          const safe = crypto.randomBytes(16).toString('hex') + ext;
          cb(null, safe);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const ok = /^image\/(jpe?g|png|webp|gif|heic)$/i.test(file.mimetype || '');
        cb(ok ? null : new Error('Only image files allowed'), ok);
      },
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  ],
  controllers: [AssetsController, AssetsPublicFileController],
  providers: [AssetsService, LifecycleService],
  exports: [AssetsService, LifecycleService],
})
export class AssetsModule {}
