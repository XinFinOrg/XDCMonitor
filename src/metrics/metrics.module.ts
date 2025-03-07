import { Module } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { MetricsService } from '@metrics/metrics.service';

@Module({
  imports: [ConfigModule],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
