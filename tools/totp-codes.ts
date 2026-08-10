/**
 * tools/totp-codes.ts
 *
 * Prints a live TOTP code for each platform operator, so you can get through the
 * authenticator step of local 3FA login without a phone.
 *
 * Replaces the old root-level decode_totp.js, which hardcoded ENCRYPTION_KEY and a
 * frozen snapshot of seven users' encrypted secrets directly in the file — committed
 * to git, and wrong the moment a secret rotated or a user was added. This reads the
 * key from the environment and the secrets from the database, so it stays correct.
 *
 * LOCAL DEVELOPMENT ONLY. It decrypts MFA secrets; never point it at production.
 *
 * Usage:
 *   ENCRYPTION_KEY=... DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME \
 *     npx ts-node tools/totp-codes.ts [emailSubstring]
 */
import { authenticator } from 'otplib';
import { PrismaClient, makeAdapter } from '@assetmon/db';
import { decryptSecret } from '../apps/api/src/common/crypto';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Set it in the environment; this script has no default.`);
  return v;
}

const db = new PrismaClient({ adapter: makeAdapter(required('DATABASE_URL')) });
const filter = process.argv[2];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run with NODE_ENV=production — this decrypts MFA secrets.');
  }
  // decryptSecret reads ENCRYPTION_KEY from the environment via the keyring, so fail
  // early with a clear message rather than silently using the dev fallback key.
  required('ENCRYPTION_KEY');

  const users = await db.platformUser.findMany({
    where: { totpEnabled: true, ...(filter ? { email: { contains: filter } } : {}) },
    select: { email: true, totpSecret: true },
    orderBy: { email: 'asc' },
  });

  if (users.length === 0) {
    console.log(filter ? `No TOTP-enabled operator matches "${filter}".` : 'No TOTP-enabled operators found.');
    return;
  }

  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`\n  ${users.length} operator(s) — codes valid for ${remaining}s\n`);
  for (const u of users) {
    if (!u.totpSecret) { console.log(`  ${u.email.padEnd(28)} (no secret stored)`); continue; }
    try {
      console.log(`  ${u.email.padEnd(28)} ${authenticator.generate(decryptSecret(u.totpSecret))}`);
    } catch (e: any) {
      console.log(`  ${u.email.padEnd(28)} decrypt failed — is ENCRYPTION_KEY the one these were written with? (${e.message})`);
    }
  }
  console.log('');
}

main()
  .catch((e) => { console.error('FATAL:', e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
