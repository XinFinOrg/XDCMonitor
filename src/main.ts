import { AppModule } from '@/app.module';
import { CustomLoggerService } from '@logging/logger.service';
import { NestFactory } from '@nestjs/core';

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process
});

process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process
});

async function bootstrap() {
  // Add immediate console feedback for debugging
  if (process.env.NODE_ENV === 'development') {
    console.log('🚀 Starting XDC Monitor in development mode...');
    console.log('📊 Debug logging enabled');
  }

  // Create the app first
  const app = await NestFactory.create(AppModule);

  // Get our custom logger service
  const customLogger = app.get(CustomLoggerService);

  // Use our custom logger for the application
  app.useLogger(customLogger);

  // Set global prefix
  app.setGlobalPrefix('api');

  // Get configuration
  const port = process.env.PORT || 3000;
  const environment = process.env.NODE_ENV || 'development';

  // Start the application
  await app.listen(port, '0.0.0.0');

  // Log startup information using our custom logger
  customLogger.logStartupInfo(Number(port), environment);

  // Log additional info
  customLogger.log(`Prometheus metrics available at /metrics`, 'Bootstrap');
  customLogger.log(`Monitoring RPC: ${process.env.MAINNET_RPC_URL || 'https://rpc.xinfin.network'}`, 'Bootstrap');
  customLogger.log(`Chain ID: ${process.env.CHAIN_ID || '50'}`, 'Bootstrap');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    customLogger.logShutdownInfo();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    customLogger.logShutdownInfo();
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
