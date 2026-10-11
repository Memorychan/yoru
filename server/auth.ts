import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { compare, hash as passwordHash } from 'bcryptjs';
import { z } from 'zod';
import { db, hash, token, parse, redis, type AuthRequest } from './core';
import { verifyFactor } from './factors';

@Injectable()
export class MemberGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const raw = req.cookies?.yoru_session;
    if (typeof raw !== 'string') throw new UnauthorizedException('Sign in to your circle.');
    const session = await db.session.findUnique({
      where: { id: hash(raw) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || session.user.disabled)
      throw new UnauthorizedException('Your session has expired.');
    req.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    };
    return true;
  }
}
@Injectable()
export class AdminGuard extends MemberGuard {
  async canActivate(ctx: ExecutionContext) {
    await super.canActivate(ctx);
    if (ctx.switchToHttp().getRequest<AuthRequest>().user.role !== 'ADMIN')
      throw new ForbiddenException('Admin access required.');
    return true;
  }
}
const credentials = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(12).max(128),
  code: z.string().max(32).optional(),
});
async function issue(userId: string, res: Response) {
  const raw = token();
  await db.session.create({
    data: { id: hash(raw), userId, expiresAt: new Date(Date.now() + 7 * 86400000) },
  });
  res.cookie('yoru_session', raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 86400000,
  });
}
async function throttle(req: Request) {
  const key = `auth:${req.ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 900);
  if (count > 20) throw new ForbiddenException('Too many attempts. Try again in 15 minutes.');
}
@Controller('auth')
export class AuthController {
  @Post('login') async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await throttle(req);
    const input = parse(credentials, body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user || user.disabled || !(await compare(input.password, user.passwordHash)))
      throw new UnauthorizedException('Email or password is incorrect.');
    if (user.totpSecret && !(await verifyFactor(user, input.code || '')))
      throw new UnauthorizedException('Enter a valid authenticator code or unused recovery code.');
    await issue(user.id, res);
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
  @Post('join') async join(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await throttle(req);
    const input = parse(
      credentials.extend({
        name: z.string().trim().min(2).max(60),
        invite: z.string().min(20).max(128),
      }),
      body,
    );
    const password = await passwordHash(input.password, 12);
    const user = await db.$transaction(async (tx) => {
      const invitation = await tx.invite.findUnique({ where: { tokenHash: hash(input.invite) } });
      if (
        !invitation ||
        invitation.usedAt ||
        invitation.expiresAt < new Date() ||
        (invitation.email && invitation.email !== input.email)
      )
        throw new ForbiddenException(
          'This invitation is invalid, expired, or belongs to another email.',
        );
      const claim = await tx.invite.updateMany({
        where: { id: invitation.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!claim.count) throw new ConflictException('Invitation already used.');
      if (await tx.user.findUnique({ where: { email: input.email } }))
        throw new ConflictException('An account with this email already exists.');
      return tx.user.create({
        data: { email: input.email, name: input.name, passwordHash: password },
      });
    });
    await issue(user.id, res);
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
  @Get('me') @UseGuards(MemberGuard) me(@Req() req: AuthRequest) {
    return req.user;
  }
  @Post('logout') async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.cookies?.yoru_session)
      await db.session.deleteMany({ where: { id: hash(req.cookies.yoru_session) } });
    res.clearCookie('yoru_session', { path: '/' });
    return { ok: true };
  }
  @Post('password') @UseGuards(MemberGuard) async password(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({ current: z.string(), password: z.string().min(12).max(128) }),
      body,
    );
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    if (!(await compare(input.current, user.passwordHash)))
      throw new ForbiddenException('Current password is incorrect.');
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: await passwordHash(input.password, 12) },
      }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);
    return { ok: true };
  }
}
