import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { connectionReason } from './connection-errors';

export const db = new PrismaClient();
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  commandTimeout: 10000,
  connectTimeout: 10000,
  enableOfflineQueue: false,
  keepAlive: 10000,
});
redis.on('error', (error) => console.error('Redis:', connectionReason(error)));
export const queue = new Queue('media', { connection: redis });
queue.on('error', (error) => console.error('Queue producer:', connectionReason(error)));
export function createWorkerConnection() {
  const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    connectTimeout: 10000,
    keepAlive: 10000,
  });
  connection.on('error', (error) => console.error('Redis worker:', connectionReason(error)));
  return connection;
}
export const dataDir = resolve(process.env.DATA_DIR || './data');
export const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
function master() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.MASTER_KEY || ''))
    throw new Error(
      'MASTER_KEY must be 32 random bytes encoded as 64 hex characters. Run npm run setup:env.',
    );
  return Buffer.from(process.env.MASTER_KEY!, 'hex');
}
export function encrypt(data: Buffer, key: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}
export function decrypt(data: Buffer, key: Buffer, context: string) {
  if (data.length < 28) throw new Error('Invalid encrypted object');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
}
export const seal = (value: string) =>
  encrypt(Buffer.from(value), master(), 'yoru-secret-v1').toString('base64');
export const unseal = (value: string) =>
  decrypt(Buffer.from(value, 'base64'), master(), 'yoru-secret-v1').toString();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
    );
  return result.data;
}
export type AuthRequest = Request & {
  user: { id: string; name: string; email: string; role: string };
};
export const audit = (actor: string, action: string, target: string) =>
  db.audit.create({ data: { actor, action, target } });
export async function canWatch(userId: string, titleId: string) {
  const title = await db.title.findUnique({ where: { id: titleId }, include: { products: true } });
  if (
    !title ||
    title.status !== 'PUBLISHED' ||
    title.showcase ||
    (title.availableUntil && title.availableUntil < new Date())
  )
    return false;
  if (title.products.some((p) => p.active && p.mode === 'FREE')) return true;
  return !!(await db.entitlement.findFirst({
    where: {
      userId,
      revoked: false,
      product: { titleId },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  }));
}
export async function requireWatch(userId: string, titleId: string) {
  if (!(await canWatch(userId, titleId)))
    throw new ForbiddenException('This title is unavailable or requires access.');
}
export interface MediaManifest {
  master: string;
  playlists: Record<string, string>;
  files: Record<string, { object: string; type: string }>;
}
