const { Prisma, PrismaClient } = require('@prisma/client');
const { createCipheriv, createDecipheriv, randomBytes, createHash } = require('node:crypto');
const { mkdir, writeFile, readFile, rename } = require('node:fs/promises');
const path = require('node:path');
const magic = Buffer.from('YORUBK01');
const models = Prisma.dmmf.datamodel.models;
const stringify = (value) =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
function cryptKey() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.MASTER_KEY || ''))
    throw new Error('Valid MASTER_KEY required for encrypted backups.');
  return Buffer.from(process.env.MASTER_KEY, 'hex');
}
function encrypt(bytes) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cryptKey(), iv);
  cipher.setAAD(magic);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), data]);
}
function decrypt(bytes) {
  if (!bytes.subarray(0, 8).equals(magic)) throw new Error('Unsupported backup format.');
  const cipher = createDecipheriv('aes-256-gcm', cryptKey(), bytes.subarray(8, 20));
  cipher.setAAD(magic);
  cipher.setAuthTag(bytes.subarray(20, 36));
  return Buffer.concat([cipher.update(bytes.subarray(36)), cipher.final()]);
}
const client = (url) => new PrismaClient(url ? { datasources: { db: { url } } } : {});
function order() {
  const sorted = [];
  const seen = new Set();
  const visiting = new Set();
  function visit(model) {
    if (seen.has(model.name)) return;
    if (visiting.has(model.name)) throw new Error('Cyclic schema requires a reviewed migration.');
    visiting.add(model.name);
    for (const f of model.fields)
      if (f.kind === 'object' && f.relationFromFields?.length)
        visit(models.find((m) => m.name === f.type));
    visiting.delete(model.name);
    seen.add(model.name);
    sorted.push(model);
  }
  models.forEach(visit);
  return sorted;
}
const delegate = (db, name) => db[name[0].toLowerCase() + name.slice(1)];
async function snapshot(db) {
  return db.$transaction(
    async (tx) => {
      const tables = {};
      for (const model of order()) tables[model.name] = await delegate(tx, model.name).findMany();
      return JSON.parse(stringify({ format: 1, createdAt: new Date().toISOString(), tables }));
    },
    { isolationLevel: 'RepeatableRead', timeout: 180000, maxWait: 15000 },
  );
}
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function fingerprint(rows) {
  return createHash('sha256')
    .update(JSON.stringify(rows.map((r) => JSON.stringify(canonical(r))).sort()))
    .digest('hex');
}
async function restore(db, archive) {
  if (archive.format !== 1 || !archive.tables) throw new Error('Invalid archive.');
  const sorted = order();
  // Additive timing fields did not exist in older encrypted snapshots.
  for (const row of archive.tables.Episode || []) {
    if (!Object.prototype.hasOwnProperty.call(row, 'outroStart')) row.outroStart = 0;
    if (!Object.prototype.hasOwnProperty.call(row, 'outroEnd')) row.outroEnd = 0;
  }
  const known = new Set(sorted.map((model) => model.name));
  if (Object.keys(archive.tables).some((name) => !known.has(name)))
    throw new Error('Archive and schema model lists differ.');
  // Older deployments have no Drive models; only these additive tables may be absent.
  for (const model of sorted) {
    if (!(model.name in archive.tables)) {
      if (!['DriveConnection', 'DriveImport'].includes(model.name))
        throw new Error('Archive and schema model lists differ.');
      archive.tables[model.name] = [];
    }
  }
  await db.$transaction(
    async (tx) => {
      for (const model of sorted)
        if (await delegate(tx, model.name).count())
          throw new Error('Destination contains data; restore refused.');
      for (const model of sorted) {
        const input = archive.tables[model.name].map((row) => {
          const out = { ...row };
          for (const field of model.fields) {
            if (out[field.name] === null || out[field.name] === undefined) continue;
            if (field.type === 'DateTime') out[field.name] = new Date(out[field.name]);
            if (field.type === 'BigInt') out[field.name] = BigInt(out[field.name]);
          }
          return out;
        });
        for (let offset = 0; offset < input.length; offset += 100)
          await delegate(tx, model.name).createMany({ data: input.slice(offset, offset + 100) });
        const actual = await delegate(tx, model.name).findMany();
        if (fingerprint(actual) !== fingerprint(archive.tables[model.name]))
          throw new Error(`Integrity comparison failed for ${model.name}; import rolled back.`);
      }
    },
    { timeout: 180000, maxWait: 15000 },
  );
  return Object.fromEntries(sorted.map((m) => [m.name, archive.tables[m.name].length]));
}
async function writeArchive(file, archive) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, encrypt(Buffer.from(stringify(archive))), { mode: 0o600, flag: 'wx' });
}
async function readArchive(file) {
  return JSON.parse(decrypt(await readFile(file)).toString('utf8'));
}
module.exports = {
  client,
  snapshot,
  restore,
  writeArchive,
  readArchive,
  encrypt,
  decrypt,
  stringify,
};
