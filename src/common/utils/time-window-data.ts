/**
 * Time window data structure options
 */
export interface TimeWindowOptions {
  /**
   * The window duration in milliseconds
   */
  windowDurationMs: number;

  /**
   * Maximum number of data points to store
   * If not provided, there's no limit
   */
  maxDataPoints?: number;

  /**
   * Initial data points (optional)
   */
  initialData?: Array<{ timestamp: number; value: number }>;
}

/**
 * Utility for managing time-series data within a sliding time window
 * Automatically removes data points outside the specified time window
 */
export class TimeWindowData {
  private data: Array<{ timestamp: number; value: number }> = [];
  private readonly windowDurationMs: number;
  private readonly maxDataPoints?: number;

  /**
   * Create a new time window data structure
   * @param options Configuration options
   */
  constructor(options: TimeWindowOptions) {
    this.windowDurationMs = options.windowDurationMs;
    this.maxDataPoints = options.maxDataPoints;

    if (options.initialData) {
      this.data = [...options.initialData];
    }
  }

  /**
   * Add a new data point
   * @param value The value to add
   * @param timestamp Optional timestamp (defaults to current time)
   */
  addDataPoint(value: number, timestamp?: number): void {
    const time = timestamp ?? Date.now();
    this.data.push({ timestamp: time, value });
    this.cleanup();
  }

  /**
   * Get all data points within the time window
   * @param cutoffTime Optional custom cutoff time
   */
  getDataPoints(cutoffTime?: number): Array<{ timestamp: number; value: number }> {
    const cutoff = cutoffTime ?? Date.now() - this.windowDurationMs;
    return this.data.filter(point => point.timestamp >= cutoff);
  }

  /**
   * Clean up old data points outside the time window
   */
  private cleanup(): void {
    // Remove data outside the time window
    const cutoffTime = Date.now() - this.windowDurationMs;
    this.data = this.data.filter(point => point.timestamp >= cutoffTime);

    // Enforce max data points limit if specified
    if (this.maxDataPoints && this.data.length > this.maxDataPoints) {
      this.data = this.data.slice(this.data.length - this.maxDataPoints);
    }
  }

  /**
   * Get the sum of all values within the time window
   */
  getSum(cutoffTime?: number): number {
    return this.getDataPoints(cutoffTime).reduce((sum, point) => sum + point.value, 0);
  }

  /**
   * Get the average of all values within the time window
   */
  getAverage(cutoffTime?: number): number {
    const points = this.getDataPoints(cutoffTime);
    return points.length > 0 ? this.getSum(cutoffTime) / points.length : 0;
  }

  /**
   * Get the minimum value within the time window
   */
  getMin(cutoffTime?: number): number | undefined {
    const points = this.getDataPoints(cutoffTime);
    return points.length > 0 ? Math.min(...points.map(p => p.value)) : undefined;
  }

  /**
   * Get the maximum value within the time window
   */
  getMax(cutoffTime?: number): number | undefined {
    const points = this.getDataPoints(cutoffTime);
    return points.length > 0 ? Math.max(...points.map(p => p.value)) : undefined;
  }

  /**
   * Count the number of data points within the time window
   */
  count(cutoffTime?: number): number {
    return this.getDataPoints(cutoffTime).length;
  }

  /**
   * Get the most recent data point
   */
  getLatest(): { timestamp: number; value: number } | undefined {
    return this.data.length > 0 ? this.data[this.data.length - 1] : undefined;
  }

  /**
   * Clear all data points
   */
  clear(): void {
    this.data = [];
  }
}
