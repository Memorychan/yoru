import 'reflect-metadata';
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { bootstrap } from './bootstrap';
import { AuthController } from './auth';
import { CatalogController } from './catalog';
import { AdminController } from './admin';
import { UploadController } from './uploads';
import { PaymentController } from './payments';
import { SubtitleController } from './playback';
import { MfaController } from './mfa';
import { TransferController } from './transfers';
import { DriveController } from './drive';
import { MonitorController } from './monitor';
import { ColabAdminController, ColabController } from './colab';
@Module({
  controllers: [
    AuthController,
    CatalogController,
    AdminController,
    UploadController,
    PaymentController,
    SubtitleController,
    MfaController,
    TransferController,
    DriveController,
    MonitorController,
    ColabAdminController,
    ColabController,
  ],
})
class AppModule {}
bootstrap(AppModule, Number(process.env.PORT || 4000)).catch(() => {
  console.error('Yoru API could not start. Check configuration and services.');
  process.exit(1);
});
