import { AlertModule } from '@alerts/alert.module';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigAuditorService } from '@security/scanners/config-auditor.service';
import { NetworkScannerService } from '@security/scanners/network-scanner.service';
import { SecurityController } from '@security/security.controller';
import { SecurityService } from '@security/security.service';

@Module({
  imports: [ConfigModule, MetricsModule, AlertModule, ScheduleModule.forRoot()],
  controllers: [SecurityController],
  providers: [SecurityService, NetworkScannerService, ConfigAuditorService],
  exports: [SecurityService],
})
export class SecurityModule {}
