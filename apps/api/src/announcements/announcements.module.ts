import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { PlatformModule } from '../platform/platform.module';

// Imports PlatformModule to reuse the exported PlatformAnnouncementsService, so
// the tenant read and the operator writes share one audience-matching rule.
@Module({
  imports: [PlatformModule],
  controllers: [AnnouncementsController],
})
export class AnnouncementsModule {}
