import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
const url = new URL(
  process.env.LOCAL_DATABASE_URL || 'postgresql://yoru:yoru_local_only@127.0.0.1:5432/yoru',
);
if (!['127.0.0.1', 'localhost'].includes(url.hostname))
  throw new Error('Local database must bind to loopback.');
const directory = path.resolve(process.env.DATA_DIR || 'data', 'postgres');
const pg = new EmbeddedPostgres({
  databaseDir: directory,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port || 5432),
  persistent: true,
  authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'],
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: () => console.error('Local PostgreSQL process reported an error.'),
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  if (!existsSync(path.join(directory, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  const admin = pg.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  const name = url.pathname.slice(1);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid database name.');
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
    await pg.createDatabase(name);
  await admin.end();
  console.log('Local PostgreSQL ready (persistent data/postgres).');
} catch (error) {
  console.error('Local PostgreSQL startup failed:', error.code || error.name);
  await pg.stop().catch(() => {});
  process.exitCode = 1;
}
