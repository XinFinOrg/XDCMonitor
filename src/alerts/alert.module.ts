import { Module, forwardRef } from '@nestjs/common';
import { AlertService } from './alert.service';
import { NotificationController } from './notification.controller';
import { TestingController } from './testing.controller';
import { MetricsModule } from '@metrics/metrics.module';
import { ConfigModule } from '@config/config.module';
import { AlertManager } from '@common/utils/alert-manager';
import { MonitoringModule } from '@monitoring/monitoring.module';

@Module({
  imports: [MetricsModule, ConfigModule, forwardRef(() => MonitoringModule)],
  controllers: [NotificationController, TestingController],
  providers: [AlertService, AlertManager],
  exports: [AlertService],
})
export class AlertModule {}
