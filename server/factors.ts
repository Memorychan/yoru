import { TOTP, Secret } from 'otpauth';
import { db, unseal, hash, redis } from './core';
export async function verifyFactor(
  user: { id: string; email: string; totpSecret: string | null; recoveryHashes: string[] },
  code: string,
) {
  if (!user.totpSecret) return true;
  const recovery = hash(code.trim());
  if (user.recoveryHashes.includes(recovery)) {
    // Atomic removal also handles simultaneous use of two different recovery codes.
    const claimed =
      await db.$executeRaw`UPDATE "User" SET "recoveryHashes" = array_remove("recoveryHashes", ${recovery}) WHERE "id" = ${user.id} AND ${recovery} = ANY("recoveryHashes")`;
    return claimed === 1;
  }
  const totp = new TOTP({
    issuer: 'Yoru',
    label: user.email,
    secret: Secret.fromBase32(unseal(user.totpSecret)),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  });
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 30000) + delta;
  return !!(await redis.set(`totp:${user.id}:${step}`, '1', 'EX', 120, 'NX'));
}
