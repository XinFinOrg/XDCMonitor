import { Controller, Post, Body, Logger, Get, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';

interface GrafanaAlertPayload {
  // Grafana specific fields
  dashboardId?: number;
  evalMatches?: Array<{
    value: number;
    metric: string;
    tags: Record<string, string>;
  }>;
  // Grafana Unified Alerting fields
  status?: string;
  labels?: Record<string, string>;
  annotations?: {
    summary?: string;
    description?: string;
    [key: string]: string;
  };
  values?: Record<string, number>;
  // Common fields
  title?: string;
  message?: string;
  ruleId?: number;
  ruleName?: string;
  ruleUrl?: string;
  state?: string;
  imageUrl?: string;
  tags?: Record<string, string>;
}

@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly alertsService: AlertsService) {}

  @Post('telegram')
  async sendTelegramNotification(@Body() payload: GrafanaAlertPayload) {
    this.logger.log(`Received notification request from Grafana: ${JSON.stringify(payload)}`);

    // Extract the most relevant information from Grafana payload
    let title = 'Grafana Alert';
    let message = 'An alert was triggered in Grafana';
    let type: 'error' | 'warning' | 'info' = 'info';

    // Handle different Grafana alert formats
    if (payload.status) {
      // Unified Alerting format
      title = payload.annotations?.summary || payload.labels?.alertname || 'Grafana Alert';
      message = payload.annotations?.description || payload.message || 'An alert was triggered';

      // Determine severity based on status
      if (payload.status === 'firing') {
        type =
          payload.labels?.severity === 'critical'
            ? 'error'
            : payload.labels?.severity === 'warning'
              ? 'warning'
              : 'info';
      }
    } else {
      // Legacy format
      title = payload.title || payload.ruleName || 'Grafana Alert';
      message = payload.message || `Rule: ${payload.ruleName}`;

      // Determine severity based on state
      if (payload.state === 'alerting') {
        type = 'error';
      } else if (payload.state === 'pending') {
        type = 'warning';
      }
    }

    // Create an alert and send notification through the alerting service
    await this.alertsService.addAlert({
      type,
      title,
      message,
      component: 'Grafana',
    });

    return { success: true, message: 'Notification processed' };
  }

  /**
   * Test endpoint to easily trigger a notification
   * Example: GET /api/notifications/test?message=Hello&severity=info
   */
  @Get('test')
  async testNotification(
    @Query('message') message: string = 'Test notification',
    @Query('severity') severity: string = 'info',
    @Query('title') title: string = 'Test Alert',
  ) {
    this.logger.log(`Testing notification: ${title} - ${message} (${severity})`);

    const type =
      severity === 'critical' || severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info';

    await this.alertsService.addAlert({
      type,
      title,
      message,
      component: 'Test',
    });

    return {
      success: true,
      message: 'Test notification sent',
      details: { title, message, severity: type },
    };
  }
}
