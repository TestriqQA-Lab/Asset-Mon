const crypto = require('crypto');
const { authenticator } = require('otplib');

const users = [
  { email: 'op31515@plat.test', payload: 'v1:aeiacTOTDbJM2/kH:j9QW1GeF5xo5g0oZxRvuXA==:ZTI+Xj/nvQudJVkIvPlEAw==' },
  { email: 'op5401@plat.test', payload: 'v1:An5sAWlx9B0iiUcV:qOE6A0ocvGzo8OQAYwMVrg==:drYkjPC8fuihz6PyYw/fWw==' },
  { email: 'op19230@plat.test', payload: 'v1:ayXzxxrSAYDjql6k:msLFC9OqYVyT8aPo5uLvKQ==:KPStfN62uUhYSRkPHwil8Q==' },
  { email: 'op22689@plat.test', payload: 'v1:3hbIo/mST8mAR6Do:8YFoCKZnSQC0Vezl+drmeg==:v7VkPrLE2iptEG1eXO2yNA==' },
  { email: 'op17283@plat.test', payload: 'v1:Z/p+/dY12x4IBz40:pRylukYK7O3vH+IQEPbSiA==:t1exc0v8FfAwCyo3NsSpRg==' },
  { email: 'op1405@plat.test', payload: 'v1:0DGQrm7mGlHwoREv:lpkO0yU/gjI735xnCJG0NQ==:clmYsuQs+AEaI1kOHCtpAw==' },
  { email: 'op15978@plat.test', payload: 'v1:g7/NI3unPyU7KRWI:8kF0iM5lwW5RiMGPZQgkog==:broNc2p7PALbmlrbeCsj0Q==' }
];

const encKey = 'd517188cd469e3d2752affc572940dc08346b8b58c068111aec4e152707f60eb'; // From .env
const key = crypto.createHash('sha256').update(encKey).digest();

for (const user of users) {
  const parts = user.payload.split(':');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  
  const currentCode = authenticator.generate(plain);
  console.log(`Email: ${user.email} -> CODE: ${currentCode}`);
}
