import { SetMetadata } from '@nestjs/common';

// Marks a platform route as writable only by SUPER_ADMIN operators. Enforced by
// SuperAdminOnlyGuard. Default (undecorated) routes remain readable by SUPPORT.
export const SUPER_ADMIN_ONLY_KEY = 'superAdminOnly';
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY_KEY, true);
