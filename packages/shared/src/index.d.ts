export const Roles: { ADMIN: 'ADMIN'; ASSET_MANAGER: 'ASSET_MANAGER'; EMPLOYEE: 'EMPLOYEE' };
export type Role = 'ADMIN' | 'ASSET_MANAGER' | 'EMPLOYEE';
export type AssetStatus = 'IN_STOCK' | 'ASSIGNED' | 'IN_REPAIR' | 'RETIRED' | 'LOST';
export const AssetStatuses: AssetStatus[];
