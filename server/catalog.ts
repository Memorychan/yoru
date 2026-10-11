import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { db, canWatch, parse, type AuthRequest } from './core';
import { MemberGuard } from './auth';
const visible = {
  status: 'PUBLISHED',
  OR: [{ availableUntil: null }, { availableUntil: { gt: new Date() } }],
};
const includes = {
  products: { where: { active: true } },
  episodes: {
    orderBy: [{ season: 'asc' as const }, { number: 'asc' as const }],
    select: {
      id: true,
      name: true,
      season: true,
      number: true,
      duration: true,
      introStart: true,
      introEnd: true,
      asset: { select: { id: true } },
    },
  },
};
@Controller()
@UseGuards(MemberGuard)
export class CatalogController {
  @Get('catalog') async catalog() {
    return db.title.findMany({
      where: { ...visible, OR: [{ availableUntil: null }, { availableUntil: { gt: new Date() } }] },
      include: includes,
      orderBy: { createdAt: 'desc' },
    });
  }
  @Get('catalog/:id') async detail(@Param('id') id: string, @Req() req: AuthRequest) {
    const title = await db.title.findFirst({
      where: {
        id,
        status: 'PUBLISHED',
        OR: [{ availableUntil: null }, { availableUntil: { gt: new Date() } }],
      },
      include: includes,
    });
    if (!title) throw new NotFoundException('Title not found');
    return { ...title, canWatch: await canWatch(req.user.id, id) };
  }
  @Get('collections') async collections() {
    return db.collection.findMany({
      where: { enabled: true },
      orderBy: { position: 'asc' },
      include: {
        items: {
          orderBy: { position: 'asc' },
          where: {
            title: {
              status: 'PUBLISHED',
              OR: [{ availableUntil: null }, { availableUntil: { gt: new Date() } }],
            },
          },
        },
      },
    });
  }
  @Get('library') async library(@Req() req: AuthRequest) {
    const [saved, progress, entitlements, orders] = await Promise.all([
      db.saved.findMany({ where: { userId: req.user.id }, select: { titleId: true } }),
      db.progress.findMany({
        where: { userId: req.user.id, episode: { title: { status: 'PUBLISHED' } } },
        include: {
          episode: { include: { title: { include: { products: { where: { active: true } } } } } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      db.entitlement.findMany({
        where: {
          userId: req.user.id,
          revoked: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: { product: { include: { title: true } } },
      }),
      db.order.findMany({
        where: { userId: req.user.id },
        include: { product: { include: { title: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { saved: saved.map((x) => x.titleId), progress, entitlements, orders };
  }
  @Post('saved/:id') async save(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ saved: z.boolean() }), body);
    if (!(await db.title.findFirst({ where: { id, status: 'PUBLISHED' } })))
      throw new NotFoundException();
    if (input.saved)
      await db.saved.upsert({
        where: { userId_titleId: { userId: req.user.id, titleId: id } },
        create: { userId: req.user.id, titleId: id },
        update: {},
      });
    else await db.saved.deleteMany({ where: { userId: req.user.id, titleId: id } });
    return { saved: input.saved };
  }
  @Post('progress/:episodeId') async progress(
    @Param('episodeId') episodeId: string,
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ seconds: z.number().finite().min(0) }), body);
    const episode = await db.episode.findUnique({ where: { id: episodeId } });
    if (!episode || !(await canWatch(req.user.id, episode.titleId))) throw new NotFoundException();
    const seconds = Math.min(input.seconds, episode.duration);
    return db.progress.upsert({
      where: { userId_episodeId: { userId: req.user.id, episodeId } },
      create: { userId: req.user.id, episodeId, seconds },
      update: { seconds },
    });
  }
}
