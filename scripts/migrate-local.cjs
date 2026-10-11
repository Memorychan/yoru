require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  client,
  snapshot,
  restore,
  writeArchive,
  readArchive,
  encrypt,
} = require('./database-archive.cjs');
const target =
  process.env.LOCAL_DATABASE_URL ||
  'postgresql://yoru:yoru_local_only@127.0.0.1:5432/yoru?connection_limit=5&pool_timeout=15';
async function main() {
  const sourceUrl = process.env.DATABASE_URL;
  const u = new URL(target);
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname))
    throw new Error('Migration destination must be local.');
  if (sourceUrl === target) throw new Error('Local migration is already configured.');
  const backup = path.resolve(
    'data',
    'backups',
    `supabase-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`,
  );
  const source = client();
  const destination = client(target);
  try {
    console.log('Taking a consistent encrypted snapshot of application tables…');
    const archive = await snapshot(source);
    await writeArchive(backup, archive);
    // Read/decrypt the saved file, rather than importing only an in-memory copy.
    const counts = await restore(destination, await readArchive(backup));
    const env = await fs.readFile('.env', 'utf8');
    await fs.writeFile(`${backup}.env.bin`, encrypt(Buffer.from(env)), { mode: 0o600, flag: 'wx' });
    let updated = env
      .replace(/^DATABASE_URL=.*$/m, () => `DATABASE_URL=${JSON.stringify(target)}`)
      .replace(/^REDIS_URL=.*$/m, 'REDIS_URL=redis://127.0.0.1:6379');
    const temp = '.env.local-migration.tmp';
    await fs.writeFile(temp, updated, { mode: 0o600 });
    await fs.rename(temp, '.env');
    console.log(
      JSON.stringify({
        migrated: true,
        rows: counts,
        encryptedBackup: backup,
        connections: 'local PostgreSQL and local Redis',
      }),
    );
  } finally {
    await source.$disconnect();
    await destination.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    'Migration stopped:',
    error.code || error.name,
    /Destination contains|Integrity comparison|Archive and schema|Migration destination|already configured/.test(
      error.message,
    )
      ? error.message
      : 'Inspect database connectivity and configuration. Existing source data was not deleted.',
  );
  process.exitCode = 1;
});
