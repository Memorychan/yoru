require('dotenv').config();
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, openSync, closeSync, readdirSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const data = path.resolve(process.env.DATA_DIR || 'data');
function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
function background(bin, args, name) {
  mkdirSync(data, { recursive: true });
  const log = openSync(path.join(data, `${name}.log`), 'a');
  const child = spawn(bin, args, {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  child.on('error', () => {
    console.error(`Unable to start ${name}.`);
    process.exitCode = 1;
  });
  child.unref();
  closeSync(log);
}
function findRedis(folder) {
  if (!existsSync(folder)) return;
  for (const e of readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, e.name);
    if (e.name === 'redis-server.exe') return file;
    if (e.isDirectory()) {
      const found = findRedis(file);
      if (found) return found;
    }
  }
}
async function main() {
  const db = new URL(process.env.DATABASE_URL || 'postgresql://localhost:5432/yoru');
  const redis = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  const local = (u) => ['127.0.0.1', 'localhost'].includes(u.hostname);
  if (local(db) && !(await listening(Number(db.port || 5432)))) {
    process.env.LOCAL_DATABASE_URL = process.env.DATABASE_URL;
    background(process.execPath, [path.join(root, 'scripts/local-postgres.mjs')], 'postgres');
  }
  if (local(redis) && !(await listening(Number(redis.port || 6379)))) {
    const bin =
      process.platform === 'win32' ? findRedis(path.join(root, 'tools', 'redis')) : 'redis-server';
    if (!bin)
      throw new Error('Run npm run local:install first to install the portable Windows queue.');
    const directory = path.join(data, 'redis');
    mkdirSync(directory, { recursive: true });
    background(
      bin,
      [
        '--bind',
        '127.0.0.1',
        '--port',
        redis.port || '6379',
        '--protected-mode',
        'yes',
        '--appendonly',
        'yes',
        '--appendfsync',
        'everysec',
        '--dir',
        directory,
      ],
      'redis',
    );
  }
  for (const u of [db, redis].filter(local)) {
    const port = Number(u.port || (u === db ? 5432 : 6379));
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (await listening(port)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready)
      throw new Error(
        `Local service ${port} did not start. Check data/postgres.log or data/redis.log.`,
      );
  }
  console.log('Database and queue endpoints ready.');
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
