// One Space/container, one database, one queue, one media worker.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const children = new Map();
let stopping = false;
let recovered = false;
const data = path.resolve(process.env.DATA_DIR || '/home/node/data');
const pgBin = process.env.PG_BIN || '/usr/lib/postgresql/15/bin';
function run(bin, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Setup command failed (${path.basename(bin)}).`)),
    );
  });
}
function launch(name, bin, args, env = {}) {
  const p = spawn(bin, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.set(name, p);
  p.on('error', () => {
    console.error(`${name} failed to start.`);
    void stop(1);
  });
  p.on('exit', () => {
    children.delete(name);
    if (!stopping) {
      console.error(`${name} stopped; shutting down safely.`);
      void stop(1);
    }
  });
  return p;
}
async function terminate(name) {
  const p = children.get(name);
  if (!p) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      resolve();
    }, 15000);
    p.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    p.kill('SIGTERM');
  });
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Stop writers before taking the last snapshot; database remains alive until then.
  await Promise.all(['web', 'api', 'gateway', 'worker', 'backup'].map(terminate));
  if (recovered)
    try {
      await run(process.execPath, ['scripts/hf-backup.cjs', 'backup']);
    } catch {
      console.error('Final backup failed; the last acknowledged remote snapshot is retained.');
    }
  await Promise.all(['redis', 'postgres'].map(terminate));
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
async function main() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.MASTER_KEY || ''))
    throw new Error('Set the existing MASTER_KEY as a Space secret.');
  if (!process.env.BACKUP_HF_BUCKET || !process.env.BACKUP_HF_TOKEN)
    throw new Error('Configure the encrypted backup bucket and token before starting this Space.');
  if (!/^https:\/\//.test(process.env.APP_ORIGIN || ''))
    throw new Error('Set APP_ORIGIN to the public HTTPS Space URL.');
  const password = createHash('sha256')
    .update(process.env.MASTER_KEY + 'local-postgres-v1')
    .digest('hex');
  process.env.DATABASE_URL = `postgresql://yoru:${password}@127.0.0.1:5432/yoru?connection_limit=5&pool_timeout=15`;
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.DATA_DIR = data;
  const pgData = path.join(data, 'postgres');
  await fs.mkdir(data, { recursive: true });
  try {
    await fs.access(path.join(pgData, 'PG_VERSION'));
  } catch {
    const pwfile = path.join(data, '.pg-password');
    await fs.writeFile(pwfile, password, { mode: 0o600 });
    try {
      await run(path.join(pgBin, 'initdb'), [
        '-D',
        pgData,
        '-U',
        'yoru',
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C',
        `--pwfile=${pwfile}`,
      ]);
    } finally {
      await fs.unlink(pwfile);
    }
  }
  // Debian's default socket directory is owned by postgres, while Spaces runs as node.
  const pgSocket = path.join(data, 'pg-socket');
  await fs.mkdir(pgSocket, { recursive: true, mode: 0o700 });
  launch('postgres', path.join(pgBin, 'postgres'), [
    '-D', pgData, '-h', '127.0.0.1', '-p', '5432', '-k', pgSocket,
  ]);
  const { client } = require('./database-archive.cjs');
  const admin = client(process.env.DATABASE_URL.replace('/yoru?', '/postgres?'));
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await admin.$queryRawUnsafe('SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ready) throw new Error('Local PostgreSQL startup timed out.');
    const rows = await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname='yoru'");
    if (!rows.length) await admin.$executeRawUnsafe('CREATE DATABASE yoru');
  } finally {
    await admin.$disconnect();
  }
  await fs.mkdir(path.join(data, 'redis'), { recursive: true });
  launch('redis', 'redis-server', [
    '--bind',
    '127.0.0.1',
    '--protected-mode',
    'yes',
    '--appendonly',
    'yes',
    '--dir',
    path.join(data, 'redis'),
  ]);
  await run(process.execPath, [
    'node_modules/prisma/build/index.js',
    'db',
    'push',
    '--skip-generate',
  ]);
  // Fails closed on absent/corrupt backups; never seed over a failed restore.
  await run(process.execPath, ['scripts/hf-backup.cjs', 'restore']);
  recovered = true;
  await run(process.execPath, ['scripts/reconcile-staging.cjs']);
  launch('api', process.execPath, ['dist/server/main.js'], { PORT: '4000' });
  launch('gateway', process.execPath, ['dist/server/gateway.js'], { GATEWAY_PORT: '4001' });
  launch('worker', process.execPath, ['dist/server/worker.js']);
  launch('backup', process.execPath, ['scripts/hf-backup.cjs', 'daemon']);
  launch(
    'web',
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', '7860'],
    { PORT: '7860' },
  );
}
main().catch((e) => {
  console.error('Space startup:', e.message);
  void stop(1);
});
