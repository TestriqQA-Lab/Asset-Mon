const crypto = require('crypto');
const { authenticator } = require('otplib');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function simulate() {
  const encKey = 'd517188cd469e3d2752affc572940dc08346b8b58c068111aec4e152707f60eb';
  const key = crypto.createHash('sha256').update(encKey).digest();
  
  // Use op1405@plat.test
  const payload = 'v1:0DGQrm7mGlHwoREv:lpkO0yU/gjI735xnCJG0NQ==:clmYsuQs+AEaI1kOHCtpAw==';
  
  const parts = payload.split(':');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const secret = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  
  const code = authenticator.generate(secret);
  console.log("Generated code:", code);
  
  // Check the delta against the same secret
  const delta = authenticator.checkDelta(code, secret);
  console.log("Delta:", delta);
  if (delta !== null && delta !== undefined) {
    console.log("Valid! Step:", Math.floor(Date.now() / 1000 / 30) + delta);
  } else {
    console.log("Invalid!");
  }
}
simulate();
