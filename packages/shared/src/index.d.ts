export const Roles: { ADMIN: 'ADMIN'; ASSET_MANAGER: 'ASSET_MANAGER'; EMPLOYEE: 'EMPLOYEE' };
export type Role = 'ADMIN' | 'ASSET_MANAGER' | 'EMPLOYEE';
export type AssetStatus = 'PENDING' | 'AVAILABLE' | 'ASSIGNED' | 'OUT_OF_SERVICE' | 'OUT_FOR_REPAIR' | 'LOST_STOLEN' | 'ARCHIVED';
export const AssetStatuses: AssetStatus[];
