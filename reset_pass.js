const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('DemoPass123', 12);
console.log(`UPDATE "User" SET "passwordHash" = '${hash}', "failedLoginCount" = 0, "lockedUntil" = NULL WHERE email = 'admin@s4demo10679.test';`);
