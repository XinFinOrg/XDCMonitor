import { Point } from '@influxdata/influxdb-client';
import { MetricsService } from '@metrics/metrics.service';
import { AlertsService } from '@monitoring/alerts.service';
import { Injectable, Logger } from '@nestjs/common';
import { TimeWindowData } from '@common/utils/time-window-data';

/**
 * Threshold definition
 */
export interface MetricThreshold {
  /** Threshold value to compare against */
  value: number;

  /** Comparison operator */
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

  /** Alert severity when threshold is crossed */
  alertSeverity: 'info' | 'warning' | 'error';

  /** Alert title when threshold is crossed */
  alertTitle: string;

  /** Alert component tag */
  component: string;

  /** Unit of measurement for the value */
  unit?: string;

  /** Minimum time duration (ms) the threshold must be exceeded before alerting */
  minDurationMs?: number;
}

/**
 * Metric value state to track in a time window
 */
interface MetricState {
  /** Metric name */
  name: string;

  /** Time window data for this metric */
  data: TimeWindowData;

  /** Thresholds for this metric */
  thresholds: MetricThreshold[];

  /** Most recent values that have crossed a threshold and when they started */
  thresholdViolations: Map<
    MetricThreshold,
    {
      since: number;
      lastValue: number;
      alerted: boolean;
    }
  >;
}

/**
 * Manages metrics collection and threshold checks in a centralized way
 */
@Injectable()
export class MetricsManager {
  private readonly logger = new Logger(MetricsManager.name);
  private metrics = new Map<string, MetricState>();

  constructor(
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService,
  ) {}

  /**
   * Register a metric with optional thresholds
   * @param name Metric name
   * @param windowDurationMs Time window duration in milliseconds
   * @param maxDataPoints Maximum data points to store (optional)
   * @param thresholds Thresholds for alerting (optional)
   */
  registerMetric(
    name: string,
    windowDurationMs: number = 5 * 60 * 1000, // Default: 5 minutes
    maxDataPoints?: number,
    thresholds: MetricThreshold[] = [],
  ): void {
    if (this.metrics.has(name)) {
      this.logger.warn(`Metric ${name} is already registered. Overwriting with new definition.`);
    }

    const timeWindowData = new TimeWindowData({
      windowDurationMs,
      maxDataPoints,
    });

    this.metrics.set(name, {
      name,
      data: timeWindowData,
      thresholds,
      thresholdViolations: new Map(),
    });

    this.logger.debug(
      `Registered metric "${name}" with window ${windowDurationMs}ms and ${thresholds.length} thresholds`,
    );
  }

  /**
   * Record a new value for a metric
   * @param name Metric name (must be registered first)
   * @param value Value to record
   * @param metadata Additional metadata (tags, etc.)
   */
  recordMetric(name: string, value: number, metadata: Record<string, string> = {}, chainId: number): void {
    if (!this.metrics.has(name)) {
      this.logger.warn(`Attempted to record unregistered metric "${name}". Register it first.`);
      return;
    }

    const metric = this.metrics.get(name);

    // Add data point to time window
    metric.data.addDataPoint(value);

    // Record in InfluxDB if there's specific method for this metric
    // We'll use a generic Point with tags from metadata
    try {
      const measurement = name.replace(/([A-Z])/g, '_$1').toLowerCase();
      const point = new Point(measurement);

      // Add all metadata as tags
      for (const [key, val] of Object.entries(metadata)) {
        point.tag(key, val);
      }

      // Add the value
      point.floatField('value', value);

      // Write using the writePoint method if it exists
      if (typeof this.metricsService['writePoint'] === 'function') {
        this.metricsService['writePoint'](point);
      }
    } catch (error) {
      this.logger.error(`Failed to record metric "${name}" to InfluxDB: ${error.message}`);
    }

    // Check thresholds
    this.checkThresholds(name, value, chainId);
  }

  /**
   * Check if a metric value crosses any thresholds
   * @param name Metric name
   * @param value Current value
   */
  private checkThresholds(name: string, value: number, chainId: number): void {
    const metric = this.metrics.get(name);
    if (!metric) return;

    const now = Date.now();

    // Check each threshold
    for (const threshold of metric.thresholds) {
      const exceedsThreshold = this.isThresholdExceeded(value, threshold);
      const violation = metric.thresholdViolations.get(threshold);

      if (exceedsThreshold) {
        if (!violation) {
          // New violation
          metric.thresholdViolations.set(threshold, {
            since: now,
            lastValue: value,
            alerted: false,
          });
          this.logger.debug(
            `Threshold violation started for ${name}: ${value} ${threshold.operator} ${threshold.value}`,
          );
        } else {
          // Update existing violation
          violation.lastValue = value;

          // Check if it's time to alert
          const violationDuration = now - violation.since;
          const shouldAlert =
            !violation.alerted && (!threshold.minDurationMs || violationDuration >= threshold.minDurationMs);

          if (shouldAlert) {
            this.triggerThresholdAlert(name, value, threshold, chainId);
            violation.alerted = true;
          }
        }
      } else if (violation) {
        // Violation ended
        metric.thresholdViolations.delete(threshold);
        this.logger.debug(`Threshold violation ended for ${name}`);
      }
    }
  }

  /**
   * Check if a value exceeds a threshold
   */
  private isThresholdExceeded(value: number, threshold: MetricThreshold): boolean {
    switch (threshold.operator) {
      case 'gt':
        return value > threshold.value;
      case 'lt':
        return value < threshold.value;
      case 'gte':
        return value >= threshold.value;
      case 'lte':
        return value <= threshold.value;
      case 'eq':
        return value === threshold.value;
      default:
        return false;
    }
  }

  /**
   * Trigger an alert for a threshold violation
   */
  private async triggerThresholdAlert(
    metricName: string,
    value: number,
    threshold: MetricThreshold,
    chainId: number,
  ): Promise<void> {
    const operatorText = {
      gt: 'exceeds',
      lt: 'is below',
      gte: 'is at or above',
      lte: 'is at or below',
      eq: 'equals',
    }[threshold.operator];

    const formattedValue = threshold.unit ? `${value} ${threshold.unit}` : value.toString();
    const formattedThreshold = threshold.unit ? `${threshold.value} ${threshold.unit}` : threshold.value.toString();

    const message = `Metric "${metricName}" ${operatorText} threshold: ${formattedValue} (threshold: ${formattedThreshold})`;

    try {
      await this.alertsService.createThresholdAlert(
        threshold.alertSeverity,
        threshold.component,
        threshold.alertTitle,
        value,
        threshold.value,
        threshold.unit || '',
      );

      this.logger.warn(`Alert triggered: ${message}`);
    } catch (error) {
      this.logger.error(`Failed to trigger alert for ${metricName}: ${error.message}`);
    }
  }

  /**
   * Get the current value of a metric
   * @param name Metric name
   * @returns The latest value or undefined if no data
   */
  getLatestValue(name: string): number | undefined {
    const metric = this.metrics.get(name);
    if (!metric) {
      this.logger.warn(`Attempted to get unregistered metric "${name}".`);
      return undefined;
    }

    const latest = metric.data.getLatest();
    return latest?.value;
  }

  /**
   * Get stats for a metric
   * @param name Metric name
   * @returns Statistics or undefined if metric not found
   */
  getMetricStats(name: string):
    | {
        latest?: number;
        average: number;
        min?: number;
        max?: number;
        count: number;
      }
    | undefined {
    const metric = this.metrics.get(name);
    if (!metric) {
      return undefined;
    }

    const latest = metric.data.getLatest();

    return {
      latest: latest?.value,
      average: metric.data.getAverage(),
      min: metric.data.getMin(),
      max: metric.data.getMax(),
      count: metric.data.count(),
    };
  }

  /**
   * Get active threshold violations for a metric
   * @param name Metric name
   * @returns List of violations or undefined if metric not found
   */
  getThresholdViolations(name: string):
    | Array<{
        threshold: MetricThreshold;
        since: number;
        duration: number;
        value: number;
        alerted: boolean;
      }>
    | undefined {
    const metric = this.metrics.get(name);
    if (!metric) {
      return undefined;
    }

    const now = Date.now();
    const violations = [];

    for (const [threshold, violation] of metric.thresholdViolations.entries()) {
      violations.push({
        threshold,
        since: violation.since,
        duration: now - violation.since,
        value: violation.lastValue,
        alerted: violation.alerted,
      });
    }

    return violations;
  }

  /**
   * Add a threshold to a metric
   * @param name Metric name
   * @param threshold Threshold definition
   */
  addThreshold(name: string, threshold: MetricThreshold): void {
    const metric = this.metrics.get(name);
    if (!metric) {
      this.logger.warn(`Attempted to add threshold to unregistered metric "${name}".`);
      return;
    }

    metric.thresholds.push(threshold);
  }
}
