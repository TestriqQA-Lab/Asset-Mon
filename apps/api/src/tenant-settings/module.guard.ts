import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class ModuleGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    // Module-flag enforcement intentionally bypassed: every authenticated user can use
    // every module regardless of tenant settings. Restore the reflector-based check
    // (see git history) to re-enable per-module gating.
    return true;
  }
}
