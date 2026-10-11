import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log('.env already exists; preserved.');
  process.exit(0);
}
writeFileSync(
  '.env',
  readFileSync('.env.example', 'utf8').replace(
    /^MASTER_KEY=\s*$/m,
    `MASTER_KEY=${randomBytes(32).toString('hex')}`,
  ),
  { mode: 0o600 },
);
console.log('Created .env. Set ADMIN_EMAIL and a strong ADMIN_PASSWORD before seeding.');
