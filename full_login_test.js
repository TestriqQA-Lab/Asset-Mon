const crypto = require('crypto');
const { authenticator } = require('otplib');
const http = require('http');

const API = 'http://localhost:4000/api/platform/auth';

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function decryptTotp(payload) {
  const encKey = 'd517188cd469e3d2752affc572940dc08346b8b58c068111aec4e152707f60eb';
  const key = crypto.createHash('sha256').update(encKey).digest();
  const parts = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

async function run() {
  console.log('=== Step 1: Login (password) ===');
  const resp1 = await post(`${API}/login`, { email: 'op1405@plat.test', password: 'DemoPass123' });
  console.log(JSON.stringify(resp1, null, 2));
  
  if (resp1.code === 'MFA_SETUP_REQUIRED') {
    console.log('\nMFA setup required! This user needs to complete MFA enrollment first.');
    return;
  }
  
  if (!resp1.ticket) {
    console.log('\nNo ticket returned — login may have failed.');
    return;
  }
  
  const devCode = resp1.devCode;
  console.log(`\ndevCode (email OTP): ${devCode}`);
  
  if (!devCode) {
    console.log('No devCode — cannot proceed.');
    return;
  }
  
  console.log('\n=== Step 2: Email OTP ===');
  const resp2 = await post(`${API}/mfa/email`, { ticket: resp1.ticket, code: devCode });
  console.log(JSON.stringify(resp2, null, 2));
  
  if (resp2.code !== 'TOTP_REQUIRED') {
    console.log('\nDid not get TOTP_REQUIRED.');
    return;
  }
  
  console.log('\n=== Step 3: TOTP ===');
  const secret = decryptTotp('v1:0DGQrm7mGlHwoREv:lpkO0yU/gjI735xnCJG0NQ==:clmYsuQs+AEaI1kOHCtpAw==');
  const totp = authenticator.generate(secret);
  console.log(`TOTP code: ${totp}`);
  
  const resp3 = await post(`${API}/mfa/totp`, { ticket: resp2.ticket, code: totp });
  console.log(JSON.stringify(resp3, null, 2));
  
  if (resp3.accessToken) {
    console.log('\n✅ LOGIN SUCCESSFUL!');
  } else {
    console.log('\n❌ LOGIN FAILED');
  }
}

run().catch(console.error);
