// Read-only connection/schema diagnostics. Never print credentials or database rows.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
function safeError(error) {
  let message = String(error.message);
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'REDIS_URL', 'MASTER_KEY', 'ADMIN_PASSWORD']) {
    const value = process.env[key];
    if (!value) continue;
    message = message.split(value).join('[redacted]');
    if (key.endsWith('_URL')) {
      try {
        const url = new URL(value);
        for (const part of [
          url.password,
          decodeURIComponent(url.password),
          url.username,
          url.hostname,
        ]) {
          if (part) message = message.split(part).join('[redacted]');
        }
      } catch {}
    }
  }
  return { type: error.name, code: error.code || error.errorCode, message };
}
(async () => {
  for (const [name, read] of [
    ['connection', () => db.$queryRaw`SELECT 1`],
    [
      'admin titles query',
      () =>
        db.title.findMany({
          take: 1,
          include: {
            products: { where: { active: true } },
            episodes: {
              include: {
                asset: { select: { id: true, bytes: true, storageId: true } },
                uploads: { take: 1 },
              },
            },
          },
        }),
    ],
    ['storage copy schema', () => db.assetReplica.findFirst({ select: { id: true } })],
    ['transfer schema', () => db.transfer.findFirst({ select: { id: true } })],
    [
      'member schema',
      () => db.user.findFirst({ select: { id: true, totpSecret: true, recoveryHashes: true } }),
    ],
  ]) {
    try {
      await read();
      console.log(JSON.stringify({ check: name, ok: true }));
    } catch (error) {
      console.log(JSON.stringify({ check: name, ok: false, ...safeError(error) }));
      process.exitCode = 1;
      if (error.name === 'PrismaClientInitializationError') break;
    }
  }
})().finally(() => db.$disconnect());
