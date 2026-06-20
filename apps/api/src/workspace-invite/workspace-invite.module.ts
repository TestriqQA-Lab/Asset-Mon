import { Global, Module } from '@nestjs/common';
import { WorkspaceInviteController } from './workspace-invite.controller';
import { WorkspaceInviteService } from './workspace-invite.service';

@Global()
@Module({
  controllers: [WorkspaceInviteController],
  providers: [WorkspaceInviteService],
  exports: [WorkspaceInviteService],
})
export class WorkspaceInviteModule {}
