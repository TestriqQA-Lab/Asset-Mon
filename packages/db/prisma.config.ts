import { defineConfig } from 'prisma/config';

// CLI-only configuration. The running API never reads this file: it builds its own
// connection through the mariadb driver adapter in src/index.js.
//
// `prisma generate` needs no database, so the URL is read straight from the environment
// rather than through prisma/config's `env()` helper, which throws when the variable is
// missing and would break the root postinstall on a fresh clone.
//
// Prisma 7 does not load .env by itself. Migration commands therefore need DATABASE_URL
// exported explicitly, which is deliberate — see "Migrations" in
// docs/hostinger-deployment-plan.md: they are run from a workstation, never on the host,
// because the CLI still carries a Rust schema engine that cannot start on CloudLinux.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
