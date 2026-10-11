import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
const db = new PrismaClient();
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !email.includes('@') || !password || password.length < 12)
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in .env first.');
  await db.user.upsert({
    where: { email },
    create: { email, name: 'Circle Admin', role: 'ADMIN', passwordHash: await hash(password, 12) },
    update: {},
  });
  if (process.env.SEED_SHOWCASE === 'true') {
    const entries = [
      {
        slug: 'beyond-blue',
        name: 'Beyond the Blue',
        synopsis:
          'A forgotten radio signal. A city above the clouds. One last summer to find the person on the other side.',
        genres: ['Adventure', 'Sci-fi'],
        poster: '/art/hero.png',
        backdrop: '/art/hero.png',
        category: 'ANIME',
        format: 'MOVIE',
        featured: true,
      },
      {
        slug: 'crimson-gate',
        name: 'The Crimson Gate',
        synopsis:
          'At the edge of an ancient forest, a guardian discovers that the door she protects was never meant to stay closed.',
        genres: ['Fantasy', 'Adventure'],
        poster: '/art/forest.png',
        backdrop: '/art/forest.png',
        category: 'ANIME',
        format: 'SERIES',
        featured: false,
      },
      {
        slug: 'little-orbit',
        name: 'Little Orbit',
        synopsis:
          'A very small explorer sets out on a very big journey to find a place among the stars.',
        genres: ['Adventure', 'Family'],
        poster: '/art/orbit.png',
        backdrop: '/art/orbit.png',
        category: 'CARTOON',
        format: 'MOVIE',
        featured: false,
      },
    ];
    for (const entry of entries)
      await db.title.upsert({
        where: { slug: entry.slug },
        update: {},
        create: {
          ...entry,
          languages: ['Japanese', 'English'],
          year: 2026,
          showcase: true,
          status: 'PUBLISHED',
          products: { create: { mode: 'FREE' } },
          ...(entry.format === 'MOVIE' ? { episodes: { create: { name: entry.name } } } : {}),
        },
      });
  }
  console.log('Admin account ready. Existing passwords and content were preserved.');
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
