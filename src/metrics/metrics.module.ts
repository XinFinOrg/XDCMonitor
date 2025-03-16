import { Module } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { MetricsService } from '@metrics/metrics.service';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [ConfigModule],
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
