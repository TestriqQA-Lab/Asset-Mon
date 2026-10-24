import { defineConfig } from 'prisma/config';

// CLI-only configuration. The running API never reads this file: it builds its own
// connection through the pg driver adapter in src/index.js.
//
// `prisma generate` needs no database, so the URL is read straight from the environment
// rather than through prisma/config's `env()` helper, which throws when the variable is
// missing and would break the root postinstall on a fresh clone.
//
// Prisma 7 does not load .env by itself, so migration commands need DATABASE_URL exported
// explicitly. On Hostinger that was also a hard constraint — the CLI carries a Rust schema
// engine that cannot start on CloudLinux, so migrations had to run from a workstation over
// an SSH tunnel. That host is retired and the constraint is gone; the explicit export is
// kept because it is the clearer behaviour, not because it is forced.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
