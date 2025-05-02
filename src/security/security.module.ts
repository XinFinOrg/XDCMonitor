import { Module } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { AlertModule } from '@alerts/alert.module';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { NetworkScannerService } from './scanners/network-scanner.service';
import { ConfigAuditorService } from './scanners/config-auditor.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule,
    MetricsModule,
    AlertModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [SecurityController],
  providers: [
    SecurityService,
    NetworkScannerService,
    ConfigAuditorService,
  ],
  exports: [SecurityService],
})
export class SecurityModule {}
