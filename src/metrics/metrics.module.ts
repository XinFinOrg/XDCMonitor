import { ConfigModule } from '@config/config.module';
import { MetricsController } from '@metrics/metrics.controller';
import { MetricsService } from '@metrics/metrics.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [ConfigModule],
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
