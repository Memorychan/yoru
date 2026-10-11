require('dotenv').config();
const { client, encrypt } = require('./database-archive.cjs');
const { hf } = require('./hf-backup.cjs');
const { createDecipheriv, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = client();
(async () => {
  const bucket = process.env.BACKUP_HF_BUCKET;
  if (!bucket) throw new Error('No backup bucket configured.');
  const connections = await db.storage.findMany({ where: { enabled: true } });
  for (const storage of connections) {
    if (storage.bucket.split('/')[0] !== bucket.split('/')[0]) continue;
    const bytes = Buffer.from(storage.tokenEncrypted, 'base64');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.MASTER_KEY, 'hex'),
      bytes.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from('yoru-secret-v1'));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const token = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
    const identity = await hf({ op: 'discover', token });
    if (identity.username !== bucket.split('/')[0])
      throw new Error('Backup bucket ownership mismatch.');
    await hf({ op: 'check', token, bucket });
    const env = await fs.readFile('.env', 'utf8');
    const folder = path.resolve(process.env.DATA_DIR || 'data', 'backups');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, `credentials-${randomUUID()}.bin`),
      encrypt(Buffer.from(env)),
      { mode: 0o600, flag: 'wx' },
    );
    const updated = env.replace(/^BACKUP_HF_TOKEN=.*$/m, () => `BACKUP_HF_TOKEN=${token}`);
    const temp = '.env.backup-token.tmp';
    await fs.writeFile(temp, updated, { mode: 0o600 });
    await fs.rename(temp, '.env');
    console.log('Backup credential refreshed from the verified matching admin account.');
    return;
  }
  throw new Error('No matching admin HF account found.');
})()
  .catch((e) => {
    console.error(e.code || e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
