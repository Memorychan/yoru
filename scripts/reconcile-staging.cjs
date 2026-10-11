require('dotenv').config();
const { client } = require('./database-archive.cjs');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const db = client();
(async () => {
  const rows = await db.upload.findMany({
    where: {
      OR: [
        { state: { notIn: ['READY', 'CANCELLED', 'FAILED'] } },
        {
          state: 'FAILED',
          error: { contains: 'Database restored, but the unfinished source/staging files' },
        },
      ],
    },
    select: { id: true, receivedBytes: true },
  });
  for (const row of rows) {
    const source = path.resolve(process.env.DATA_DIR || 'data', 'uploads', row.id);
    const size = await stat(source)
      .then((s) => s.size)
      .catch((e) => {
        if (e.code === 'ENOENT') return -1;
        throw e;
      });
    if (size < Number(row.receivedBytes)) {
      const imported = await db.driveImport.findUnique({ where: { uploadId: row.id } });
      if (imported) {
        await db.$transaction([
          db.upload.update({
            where: { id: row.id },
            data: {
              state: 'UPLOADING',
              receivedBytes: 0n,
              chunkHashes: [],
              progress: 0,
              stageProgress: 0,
              stageBytes: 0n,
              speedBps: 0,
              error: null,
              stageDetail: 'Restoring source from Google Drive after rebuild',
            },
          }),
          db.driveImport.update({
            where: { id: imported.id },
            data: { state: 'QUEUED', error: null },
          }),
        ]);
        console.log('Queued Drive source recovery for upload ' + row.id);
        continue;
      }
      await db.upload.update({
        where: { id: row.id },
        data: {
          state: 'FAILED',
          speedBps: 0,
          stageDetail: 'Source file missing on this host',
          error:
            'Database restored, but the unfinished source/staging files are not on this host. Restore the matching data/uploads and data/processing folders, or cancel and upload the original again.',
        },
      });
      console.log('Missing staging files require attention for upload ' + row.id);
    }
  }
})()
  .catch((e) => {
    console.error('Staging reconciliation failed:', e.code || e.name);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
