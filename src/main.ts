import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Request, Response } from 'express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  const configService = app.get(ConfigService);
  const metricsService = app.get(MetricsService);

  if (configService.enablePrometheus) {
    const server = app.getHttpAdapter().getInstance();
    server.get('/metrics', async (req: Request, res: Response) => {
      res.set('Content-Type', 'text/plain');
      try {
        const metrics = await metricsService.getMetrics();
        res.send(metrics);
      } catch (error) {
        logger.error(`Error retrieving metrics: ${error.message}`);
        res.status(500).send(`Error retrieving metrics: ${error.message}`);
      }
    });
    logger.log(`Prometheus metrics available at /metrics`);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`XDC Monitor started on port ${port}`);
  logger.log(`Monitoring RPC: ${configService.rpcUrl}`);
  logger.log(`Chain ID: ${configService.chainId}`);
}

bootstrap().catch(err => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
