import { ConfigService } from '@config/config.service';
import { Global, Module } from '@nestjs/common';

/**
 * Global configuration module providing application configuration services
 */
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService(),
    },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
