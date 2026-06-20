import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TenantProvisioningService {
  private readonly log = new Logger(TenantProvisioningService.name);

  buildTenantUrl(dbName: string): string {
    const tpl = process.env.TENANT_DB_URL_TEMPLATE!;
    return tpl.replace('{db}', dbName);
  }

  async createDatabase(dbName: string): Promise<void> {
    // Connect to postgres maintenance DB to issue CREATE DATABASE
    const admin = new Client({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: 'postgres',
    });
    await admin.connect();
    try {
      // Identifier must be safe; we generate the dbName from a slug so this is OK.
      await admin.query(`CREATE DATABASE "${dbName}"`);
      this.log.log(`Created database ${dbName}`);
    } finally {
      await admin.end();
    }
  }

  async runMigrations(dbName: string): Promise<void> {
    const migrationsDir = path.resolve(__dirname, '../../../../packages/db-tenant/prisma/migrations');
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations dir not found at ${migrationsDir}`);
    }
    const entries = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const client = new Client({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: dbName,
    });
    await client.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "_assetmon_migrations" (
          "name" TEXT PRIMARY KEY,
          "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      const applied = new Set<string>(
        (await client.query<{ name: string }>(`SELECT name FROM "_assetmon_migrations"`)).rows.map((r) => r.name),
      );
      for (const name of entries) {
        if (applied.has(name)) continue;
        const sqlPath = path.join(migrationsDir, name, 'migration.sql');
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        // If all CREATE TABLE targets already exist, record as applied without running.
        const tableNames = [...sql.matchAll(/CREATE TABLE\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]);
        if (tableNames.length > 0) {
          const r = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`,
            [tableNames],
          );
          if (r.rows.length === tableNames.length) {
            await client.query(`INSERT INTO "_assetmon_migrations" (name) VALUES ($1)`, [name]);
            this.log.log(`Marked existing migration ${name} as applied for ${dbName}`);
            continue;
          }
        }

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(`INSERT INTO "_assetmon_migrations" (name) VALUES ($1)`, [name]);
          await client.query('COMMIT');
          this.log.log(`Applied migration ${name} to ${dbName}`);
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }
    } finally {
      await client.end();
    }
  }

  async migrateAllTenants(): Promise<void> {
    // Called at startup to upgrade existing tenant DBs to current schema.
    const { PrismaClient } = require('@assetmon/db-catalog');
    const cat = new PrismaClient({ datasources: { db: { url: process.env.CATALOG_DATABASE_URL } } });
    try {
      const tenants = await cat.tenant.findMany({ where: { status: { in: ['ACTIVE', 'PROVISIONING'] } } });
      for (const t of tenants) {
        try {
          await this.runMigrations(t.dbName);
        } catch (e: any) {
          this.log.error(`Failed migrating ${t.dbName}: ${e.message}`);
        }
      }
      this.log.log(`Tenant migration scan complete: ${tenants.length} tenants`);
    } finally {
      await cat.$disconnect();
    }
  }

  async dropDatabase(dbName: string): Promise<void> {
    const admin = new Client({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: 'postgres',
    });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
