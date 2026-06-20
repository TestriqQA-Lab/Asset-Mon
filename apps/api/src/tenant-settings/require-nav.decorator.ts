import { SetMetadata } from '@nestjs/common';
import type { NavKey } from './tenant-settings.types';

/**
 * Mark a route as requiring a particular navigation key to be visible to the
 * caller's role. Hidden in the menu → blocked at the API. See `NavPermissionsGuard`.
 */
export const REQUIRE_NAV_KEY = 'requireNav';
export const RequireNav = (key: NavKey) => SetMetadata(REQUIRE_NAV_KEY, key);
