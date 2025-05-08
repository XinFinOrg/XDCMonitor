import { Module } from '@nestjs/common';
import { HealthController } from '@health/health.controller';
import { HealthService } from '@health/health.service';
import { ConfigModule } from '@config/config.module';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
