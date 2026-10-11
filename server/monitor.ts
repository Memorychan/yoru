import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { cpus, freemem, totalmem, uptime } from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import { AdminGuard } from './auth';
import { dataDir, db, queue, unseal } from './core';
import { hf } from './storage';
let previous: { time: number; usage: number } | undefined;
let host = cpus().map((c) => c.times);
async function text(path: string) {
  return readFile(path, 'utf8').catch(() => '');
}
let buckets: unknown[] = [],
  refreshedAt: string | null = null;
let pending: Promise<unknown> | undefined;
@Controller('admin/monitor')
@UseGuards(AdminGuard)
export class MonitorController {
  @Get() async status() {
    const now = Date.now();
    const [memory, limit, stats, cpuMax, disk, jobs] = await Promise.all([
      text('/sys/fs/cgroup/memory.current'),
      text('/sys/fs/cgroup/memory.max'),
      text('/sys/fs/cgroup/cpu.stat'),
      text('/sys/fs/cgroup/cpu.max'),
      statfs(dataDir).catch(() => null),
      queue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
    ]);
    const cpuQuota = cpuMax.trim().split(/\s+/);
    const capacity =
      cpuQuota[0] && cpuQuota[0] !== 'max'
        ? Number(cpuQuota[0]) / Number(cpuQuota[1])
        : cpus().length;
    const usage = Number(/usage_usec\s+(\d+)/.exec(stats)?.[1]);
    let cpu: number | null = null;
    if (Number.isFinite(usage)) {
      if (previous && now > previous.time)
        cpu = Math.min(
          100,
          Math.max(0, ((usage - previous.usage) / ((now - previous.time) * 1000 * capacity)) * 100),
        );
      previous = { time: now, usage };
    } else {
      const current = cpus().map((c) => c.times);
      let idle = 0,
        total = 0;
      current.forEach((c, i) => {
        const p = host[i];
        if (!p) return;
        idle += c.idle - p.idle;
        for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) total += c[key] - p[key];
      });
      if (total > 0) cpu = 100 * (1 - idle / total);
      host = current;
    }
    const ramTotal = limit.trim() && limit.trim() !== 'max' ? Number(limit) : totalmem();
    return {
      sampledAt: new Date().toISOString(),
      scope: stats ? 'Space container' : 'Operating system (container metrics unavailable)',
      cpu,
      cpuCapacity: capacity,
      ramUsed: memory.trim() ? Number(memory) : totalmem() - freemem(),
      ramTotal,
      disk: disk
        ? {
            total: disk.blocks * disk.bsize,
            available: disk.bavail * disk.bsize,
            used: (disk.blocks - disk.bfree) * disk.bsize,
          }
        : null,
      uptime: uptime(),
      jobs,
      buckets,
      refreshedAt,
    };
  }
  @Post('buckets') async refresh() {
    if (pending) return pending;
    if (refreshedAt && Date.now() - Date.parse(refreshedAt) < 60000)
      return { buckets, refreshedAt };
    pending = (async () => {
      const stores = await db.storage.findMany({
        select: { name: true, bucket: true, tokenEncrypted: true },
      });
      const backup = process.env.BACKUP_HF_BUCKET;
      if (backup && process.env.BACKUP_HF_TOKEN && !stores.some((s) => s.bucket === backup))
        stores.push({ name: 'Database and artwork backups', bucket: backup, tokenEncrypted: '' });
      const results = [];
      for (const store of stores) {
        try {
          const info = await hf<{ size: number; private: boolean; totalFiles: number }>({
            op: 'check',
            bucket: store.bucket,
            token: store.tokenEncrypted
              ? unseal(store.tokenEncrypted)
              : process.env.BACKUP_HF_TOKEN,
          });
          results.push({
            name: store.name,
            bucket: store.bucket,
            bytes: info.size,
            private: info.private,
            files: info.totalFiles,
          });
        } catch {
          results.push({
            name: store.name,
            bucket: store.bucket,
            error: 'Could not refresh usage. Check bucket access or connection.',
          });
        }
      }
      buckets = results;
      refreshedAt = new Date().toISOString();
      return { buckets, refreshedAt };
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  }
}
