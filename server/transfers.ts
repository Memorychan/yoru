import { Controller, Get, Post, Body, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { join, resolve, sep } from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { AdminGuard } from './auth';
import {
  db,
  dataDir,
  queue,
  parse,
  unseal,
  decrypt,
  audit,
  type AuthRequest,
  type MediaManifest,
} from './core';
import { hf } from './storage';
@Controller('admin/transfers')
@UseGuards(AdminGuard)
export class TransferController {
  @Get() list() {
    return db.transfer.findMany({
      take: 40,
      orderBy: { createdAt: 'desc' },
      include: {
        storage: { select: { name: true } },
        asset: { select: { episode: { select: { name: true } } } },
      },
    });
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = parse(
      z.object({
        episodeId: z.string(),
        storageId: z.string(),
        mode: z.enum(['REPLICATE', 'MIGRATE']),
      }),
      body,
    );
    const asset = await db.asset.findUniqueOrThrow({ where: { episodeId: input.episodeId } });
    const storage = await db.storage.findUniqueOrThrow({ where: { id: input.storageId } });
    if (!storage.enabled || storage.id === asset.storageId)
      throw new BadRequestException('Choose a different enabled connection.');
    const transfer = await db.transfer.create({
      data: { assetId: asset.id, storageId: input.storageId, mode: input.mode },
    });
    await queue.add(
      'transfer',
      { transferId: transfer.id },
      {
        jobId: `transfer-${transfer.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await audit(req.user.id, 'STORAGE_TRANSFER_QUEUED', transfer.id);
    return transfer;
  }
}
export async function processTransfer(id: string) {
  const transfer = await db.transfer.findUniqueOrThrow({
    where: { id },
    include: {
      storage: true,
      asset: { include: { storage: true, replicas: { include: { storage: true } } } },
    },
  });
  if (transfer.state === 'READY') return;
  const folder = resolve(dataDir, 'transfers', id);
  if (!folder.startsWith(resolve(dataDir, 'transfers') + sep))
    throw new Error('Unsafe transfer path');
  await mkdir(folder, { recursive: true });
  const update = (state: string, progress: number) =>
    db.transfer.update({ where: { id }, data: { state, progress, error: null } });
  try {
    const manifest = transfer.asset.manifest as unknown as MediaManifest;
    const files = Object.values(manifest.files).map((f, i) => ({
      object: f.object,
      local: join(folder, `${i}.bin`),
    }));
    if (!files.length) throw new Error('This asset has no media.');
    await update('COPYING', 10);
    let downloaded = false;
    for (const source of [
      transfer.asset.storage,
      ...transfer.asset.replicas.map((r) => r.storage),
    ]) {
      try {
        await hf({
          op: 'download-many',
          bucket: source.bucket,
          token: unseal(source.tokenEncrypted),
          files,
        });
        downloaded = true;
        break;
      } catch {
        /* Try a verified replica if the primary is unavailable. */
      }
    }
    if (!downloaded) throw new Error('No readable source storage connection.');
    const key = Buffer.from(unseal(transfer.asset.keyEncrypted), 'hex');
    for (const file of files) decrypt(await readFile(file.local), key, file.object);
    await update('COPYING', 50);
    await hf({
      op: 'upload',
      bucket: transfer.storage.bucket,
      token: unseal(transfer.storage.tokenEncrypted),
      files,
    });
    await update('VERIFYING', 90);
    for (const file of [files[0], files[files.length - 1]]) {
      const local = join(folder, 'verify.bin');
      await hf({
        op: 'download',
        bucket: transfer.storage.bucket,
        token: unseal(transfer.storage.tokenEncrypted),
        object: file.object,
        local,
      });
      decrypt(await readFile(local), key, file.object);
    }
    await db.$transaction(async (tx) => {
      // Lock the row while attaching copies so replacements cannot retain stale replicas.
      const locked = await tx.asset.updateMany({
        where: {
          id: transfer.assetId,
          keyEncrypted: transfer.asset.keyEncrypted,
          storageId: transfer.asset.storageId,
        },
        data: { bytes: transfer.asset.bytes },
      });
      if (!locked.count) throw new Error('Media changed during the copy. Create a new transfer.');
      const current = await tx.asset.findUniqueOrThrow({ where: { id: transfer.assetId } });
      if (JSON.stringify(current.manifest) !== JSON.stringify(transfer.asset.manifest))
        throw new Error('Subtitles or media changed during the copy. Create a new transfer.');
      if (transfer.mode === 'MIGRATE') {
        await tx.assetReplica.upsert({
          where: {
            assetId_storageId: { assetId: transfer.assetId, storageId: transfer.asset.storageId },
          },
          create: { assetId: transfer.assetId, storageId: transfer.asset.storageId },
          update: {},
        });
        await tx.asset.update({
          where: { id: transfer.assetId },
          data: { storageId: transfer.storageId },
        });
        await tx.assetReplica.deleteMany({
          where: { assetId: transfer.assetId, storageId: transfer.storageId },
        });
      } else
        await tx.assetReplica.upsert({
          where: {
            assetId_storageId: { assetId: transfer.assetId, storageId: transfer.storageId },
          },
          create: { assetId: transfer.assetId, storageId: transfer.storageId },
          update: {},
        });
      await tx.transfer.update({
        where: { id },
        data: { state: 'READY', progress: 100, error: null },
      });
    });
  } catch (error) {
    await db.transfer.update({
      where: { id },
      data: { state: 'FAILED', error: error instanceof Error ? error.message : 'Transfer failed' },
    });
    throw error;
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}
