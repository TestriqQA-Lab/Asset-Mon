import { SetMetadata } from '@nestjs/common';
import type { ModuleKey } from './tenant-settings.types';

export const REQUIRE_MODULE_KEY = 'requireModule';
export const RequireModule = (mod: ModuleKey) => SetMetadata(REQUIRE_MODULE_KEY, mod);
