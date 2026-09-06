import { hashPassword } from '../server/auth.js';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "a-long-password"');
  process.exit(2);
}
console.log(hashPassword(password));
