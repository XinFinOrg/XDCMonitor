import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { CustomLoggerService } from './logger.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CustomLoggerService],
  exports: [CustomLoggerService],
})
export class LoggerModule {}
