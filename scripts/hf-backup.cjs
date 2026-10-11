require('dotenv').config();
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createDecipheriv } = require('node:crypto');
const { client, snapshot, restore, writeArchive, readArchive } = require('./database-archive.cjs');
const data = path.resolve(process.env.DATA_DIR || 'data');
function hf(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.PYTHON_BIN || 'python',
      [path.resolve('scripts/hf-storage.py')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    const timer = setTimeout(
      () => {
        child.kill();
        reject(new Error('HF backup request timed out.'));
      },
      request.op === 'upload' ? 30 * 60 * 1000 : 180000,
    );
    child.stdout.on('data', (b) => {
      output += b;
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Cannot start HF backup adapter.'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code !== 0 || !result.ok) {
          reject(new Error(result.message || 'HF backup failed.'));
          return;
        }
        resolve(result);
      } catch (e) {
        reject(new Error('HF backup operation failed; check network, token and bucket access.'));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
function config() {
  // Pick up native .env credential rotation without restarting the scheduler.
  // Spaces use process secrets and do not have an .env file.
  try {
    const saved = require('dotenv').parse(require('node:fs').readFileSync('.env'));
    for (const name of ['BACKUP_HF_TOKEN', 'BACKUP_HF_BUCKET'])
      if (saved[name]) process.env[name] = saved[name];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!process.env.BACKUP_HF_TOKEN || !process.env.BACKUP_HF_BUCKET)
    throw new Error('Set BACKUP_HF_TOKEN and BACKUP_HF_BUCKET.');
  return { token: process.env.BACKUP_HF_TOKEN, bucket: process.env.BACKUP_HF_BUCKET };
}
async function backup() {
  const cfg = config();
  const db = client();
  const file = path.join(data, 'backups', `upload-${randomUUID()}.bin`);
  try {
    const archive = await snapshot(db);
    await writeArchive(file, archive);
    await hf({ ...cfg, op: 'upload', files: [{ local: file, object: 'database-latest.bin' }] });
    console.log('Encrypted HF database backup saved at ' + new Date().toISOString());
  } finally {
    await db.$disconnect();
    await fs.unlink(file).catch(() => {});
  }
}
async function recover() {
  const cfg = config();
  const db = client();
  const file = path.join(data, 'backups', `restore-${randomUUID()}.bin`);
  try {
    if (await db.user.count()) {
      console.log('Local database already has users; automatic restore skipped.');
      return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await hf({ ...cfg, op: 'download', object: 'database-latest.bin', local: file });
    const archive = await readArchive(file);
    const images = archive.artwork || {};
    for (const [name, bytes] of Object.entries(images)) {
      if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/.test(name) || typeof bytes !== 'string')
        throw new Error('Invalid artwork in backup.');
    }
    // Restore files first: a failed file write must not leave a populated DB that skips recovery.
    await fs.mkdir(path.join(data, 'artwork'), { recursive: true });
    for (const [name, bytes] of Object.entries(images))
      await fs.writeFile(path.join(data, 'artwork', name), Buffer.from(bytes, 'base64'));
    const counts = await restore(db, archive);
    console.log('Encrypted backup restored and row integrity verified: ' + JSON.stringify(counts));
  } finally {
    await db.$disconnect();
    await fs.unlink(file).catch(() => {});
  }
}
async function provision() {
  if (process.env.BACKUP_HF_BUCKET) {
    console.log('Backup bucket already configured.');
    return;
  }
  const db = client();
  try {
    const storage = await db.storage.findFirst({ where: { enabled: true } });
    if (!storage) throw new Error('Connect an HF account in Admin first.');
    const sealed = Buffer.from(storage.tokenEncrypted, 'base64');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.MASTER_KEY, 'hex'),
      sealed.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from('yoru-secret-v1'));
    cipher.setAuthTag(sealed.subarray(12, 28));
    const token = Buffer.concat([cipher.update(sealed.subarray(28)), cipher.final()]).toString();
    const identity = await hf({ op: 'discover', token });
    const bucket = `${identity.username}/yoru-backups-${randomUUID().slice(0, 8)}`;
    await hf({ op: 'create', token, bucket, private: true });
    const env = await fs.readFile('.env', 'utf8');
    await fs.writeFile(
      '.env',
      env +
        `\n# Private encrypted database recovery (also set as Space secrets)\nBACKUP_HF_BUCKET=${bucket}\nBACKUP_HF_TOKEN=${token}\nBACKUP_INTERVAL_SECONDS=900\n`,
      { mode: 0o600 },
    );
    process.env.BACKUP_HF_BUCKET = bucket;
    process.env.BACKUP_HF_TOKEN = token;
    console.log('Private encrypted backup bucket configured: ' + bucket);
  } finally {
    await db.$disconnect();
  }
  await backup();
}
async function daemon() {
  if (!process.env.BACKUP_HF_BUCKET) {
    console.log('HF backups disabled; configure BACKUP_HF_BUCKET and BACKUP_HF_TOKEN.');
    return;
  }
  let stopping = false;
  process.on('SIGTERM', () => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });
  const seconds = Math.max(60, Number(process.env.BACKUP_INTERVAL_SECONDS) || 900);
  while (!stopping) {
    try {
      await backup();
    } catch (e) {
      console.error(e.message);
    }
    for (let i = 0; i < seconds && !stopping; i++) await new Promise((r) => setTimeout(r, 1000));
  }
  await backup();
}
async function status() {
  const cfg = config();
  const identity = await hf({ op: 'discover', token: cfg.token });
  const info = await hf({ ...cfg, op: 'check' });
  console.log(
    JSON.stringify({
      bucket: cfg.bucket,
      ownedByConnectedAccount: cfg.bucket.split('/')[0] === identity.username,
      ...info,
    }),
  );
}
if (require.main === module) {
  const op = process.argv[2] || 'backup';
  const action = { backup, restore: recover, provision, daemon, status }[op];
  if (!action) {
    console.error('Use backup, restore, provision or daemon.');
    process.exitCode = 1;
  } else
    action().catch((e) => {
      console.error('Database backup:', e.code || e.message);
      process.exitCode = 1;
    });
}
module.exports = { backup, recover, hf };
