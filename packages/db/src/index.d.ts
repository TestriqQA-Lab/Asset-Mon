import type { PrismaMariaDb } from '@prisma/adapter-mariadb';

export * from './generated';

/**
 * The driver adapter every Prisma client here is constructed with. Prisma 7 has no query
 * engine, so a client without one cannot reach the database. Defaults to DATABASE_URL.
 *
 * `overrides` is merged over the pool defaults, for batch scripts that need their own.
 */
export declare function makeAdapter(
  url?: string,
  overrides?: Record<string, unknown>,
): PrismaMariaDb;
