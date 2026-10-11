import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Catch, ExceptionFilter, ArgumentsHost, HttpException, type Type } from '@nestjs/common';
import { raw, static as serveStatic } from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { dataDir, origin, seal } from './core';
import { artworkName, loadArtwork } from './artwork';
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const result = error.getResponse();
      return res.status(error.getStatus()).json({
        message: typeof result === 'string' ? result : (result as { message: unknown }).message,
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Log only stable error codes/model names, never query text, parameters or credentials.
      console.error('Database request failed', { code: error.code, model: error.meta?.modelName });
      if (error.code === 'P2025') return res.status(404).json({ message: 'Record not found.' });
      if (error.code === 'P2002')
        return res.status(409).json({ message: 'This record already exists.' });
      if (['P2021', 'P2022'].includes(error.code))
        return res.status(503).json({
          message:
            'Database schema is out of date. Apply the Prisma schema update and restart the app.',
          code: error.code,
        });
      if (['P1001', 'P1002', 'P1017', 'P2024', 'P2037'].includes(error.code))
        return res.status(503).json({
          message: 'Database connection is unavailable or busy. Retry shortly.',
          code: error.code,
        });
      return res
        .status(500)
        .json({ message: 'The database could not complete this request.', code: error.code });
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
      console.error('Database connection failed', { code: error.errorCode });
      return res.status(503).json({
        message: 'Cannot connect to the database. Check DATABASE_URL and database availability.',
        code: error.errorCode,
      });
    }
    console.error(error instanceof Error ? error.name : 'Server error');
    return res.status(500).json({
      message: 'Unable to complete the request. Check server configuration and try again.',
    });
  }
}
export async function bootstrap(module: Type<unknown>, port: number) {
  seal('startup-key-validation');
  const app = await NestFactory.create<NestExpressApplication>(module, { rawBody: true });
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  app
    .getHttpAdapter()
    .getInstance()
    .set('json replacer', (_key: string, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }),
  );
  app.use(cookieParser());
  app.use('/api/playback/cast', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.path !== '/api/payments/webhook' &&
      !req.path.startsWith('/api/colab/') &&
      req.headers.origin !== origin
    )
      return res.status(403).json({ message: 'Request origin is not allowed.' });
    next();
  });
  app.use(
    '/api/admin/uploads',
    (req: Request & { uploadStartedAt?: number }, _res: Response, next: NextFunction) => {
      req.uploadStartedAt = Date.now();
      next();
    },
    raw({ type: 'application/octet-stream', limit: '8mb' }),
  );
  app.use(
    '/api/artwork',
    serveStatic(join(dataDir, 'artwork'), { index: false, dotfiles: 'deny', maxAge: '1d' }),
  );
  app.use('/api/artwork', async (req: Request, res: Response, next: NextFunction) => {
    const name = req.path.slice(1);
    if (!['GET', 'HEAD'].includes(req.method) || !artworkName.test(name)) return next();
    try {
      const bytes = await loadArtwork(name);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res
        .type(
          name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
        )
        .send(bytes);
    } catch {
      res.status(503).setHeader('Cache-Control', 'no-store').end();
    }
  });
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}
