const crypto = require('crypto');
const { authenticator } = require('otplib');
const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:demo_pw_3k9q@postgres:5432/assetmon_catalog?schema=public'
  });
  await client.connect();
  const res = await client.query('SELECT email, "totpSecret" FROM "PlatformUser" WHERE "totpSecret" IS NOT NULL');
  if (res.rows.length === 0) {
    console.log("No PlatformUsers with TOTP secret found!");
    await client.end();
    return;
  }
  
  for (const user of res.rows) {
    const payload = user.totpSecret;
    const encKey = 'd517188cd469e3d2752affc572940dc08346b8b58c068111aec4e152707f60eb'; // From .env
    const key = crypto.createHash('sha256').update(encKey).digest();
    
    const parts = payload.split(':');
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    
    console.log(`\nEmail: ${user.email}`);
    // Generate code directly immediately
    console.log(`CODE (current): ${authenticator.generate(plain)}`);
    console.log(`CODE (next 30s): ${authenticator.generate(plain, Math.floor(Date.now() / 1000) + 30)}`);
  }
  
  await client.end();
}
run().catch(console.error);
