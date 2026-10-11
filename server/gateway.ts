import 'reflect-metadata';
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { bootstrap } from './bootstrap';
import { PlaybackController, CastPlaybackController } from './playback';
@Module({ controllers: [CastPlaybackController, PlaybackController] })
class MediaModule {}
bootstrap(MediaModule, Number(process.env.GATEWAY_PORT || 4001)).catch(() => {
  console.error('Yoru media gateway could not start. Check configuration and services.');
  process.exit(1);
});
