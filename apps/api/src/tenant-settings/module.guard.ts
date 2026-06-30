import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_MODULE_KEY } from './require-module.decorator';
import { mergeSettings, type ModuleKey } from './tenant-settings.types';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ModuleKey | undefined>(
      REQUIRE_MODULE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    // Route isn't module-gated → allow.
    if (!required) return true;

    // `req.tenant` (with its full `settings` JSON) is attached by JwtAuthGuard for
    // both JWT and API-key auth, so this needs no extra DB read. mergeSettings()
    // backfills every module key to its default (ON), so a tenant with no/partial
    // settings is never accidentally blocked.
    const req = ctx.switchToHttp().getRequest();
    const modules = mergeSettings(req.tenant?.settings).modules;

    // Deliberately NO admin auto-pass: a turned-off module is blocked for everyone,
    // including the admin who turned it off — that is what "truly disabled" means.
    if (modules[required] === false) {
      throw new ForbiddenException(`The "${required}" feature is turned off for this workspace.`);
    }
    return true;
  }
}
