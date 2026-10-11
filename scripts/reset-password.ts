import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
const db = new PrismaClient();
async function main() {
  const email = process.env.RESET_EMAIL?.trim().toLowerCase();
  const password = process.env.RESET_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error('Set RESET_EMAIL and RESET_PASSWORD (12+ characters) in your local shell.');
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: await hash(password, 12) } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    db.playback.deleteMany({ where: { userId: user.id } }),
  ]);
  console.log('Password updated. All sessions revoked.');
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
