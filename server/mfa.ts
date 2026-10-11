import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { TOTP, Secret } from 'otpauth';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { db, seal, unseal, hash, token, parse, audit, type AuthRequest } from './core';
import { MemberGuard } from './auth';
import { verifyFactor } from './factors';
@Controller('auth/mfa')
@UseGuards(MemberGuard)
export class MfaController {
  @Get() async status(@Req() req: AuthRequest) {
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    return { enabled: !!user.totpSecret, recoveryRemaining: user.recoveryHashes.length };
  }
  @Post('setup') async setup(@Req() req: AuthRequest, @Body() body: unknown) {
    const { password } = parse(z.object({ password: z.string().max(128) }), body);
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    if (!(await compare(password, user.passwordHash)))
      throw new ForbiddenException('Incorrect password.');
    if (user.totpSecret)
      throw new ConflictException('Two-factor authentication is already enabled.');
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ issuer: 'Yoru', label: user.email, secret });
    await db.user.update({ where: { id: user.id }, data: { totpPending: seal(secret.base32) } });
    return { secret: secret.base32, uri: totp.toString() };
  }
  @Post('enable') async enable(@Req() req: AuthRequest, @Body() body: unknown) {
    const { code } = parse(z.object({ code: z.string().length(6) }), body);
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    if (!user.totpPending || user.totpSecret) throw new ConflictException('Start setup again.');
    const totp = new TOTP({
      issuer: 'Yoru',
      label: user.email,
      secret: Secret.fromBase32(unseal(user.totpPending)),
    });
    if (totp.validate({ token: code, window: 1 }) === null)
      throw new ForbiddenException('That code is incorrect or expired.');
    const codes = Array.from({ length: 8 }, () => token().slice(0, 16));
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { totpSecret: user.totpPending, totpPending: null, recoveryHashes: codes.map(hash) },
      }),
      db.session.deleteMany({
        where: { userId: user.id, id: { not: hash(req.cookies.yoru_session) } },
      }),
    ]);
    await audit(user.id, 'MFA_ENABLED', user.id);
    return { recoveryCodes: codes };
  }
  @Post('disable') async disable(@Req() req: AuthRequest, @Body() body: unknown) {
    const { password, code } = parse(
      z.object({ password: z.string().max(128), code: z.string().max(32) }),
      body,
    );
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
    if (!(await compare(password, user.passwordHash)) || !(await verifyFactor(user, code)))
      throw new ForbiddenException('Incorrect password or verification code.');
    await db.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpPending: null, recoveryHashes: [] },
    });
    await audit(user.id, 'MFA_DISABLED', user.id);
    return { ok: true };
  }
}
