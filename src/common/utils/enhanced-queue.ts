import { Logger } from '@nestjs/common';

export enum Priority {
  HIGH = 0,
  NORMAL = 1,
  LOW = 2,
}

export interface QueueItem<T> {
  id: string;
  data: T;
  priority: Priority;
  createdAt: number;
  attempts: number;
  lastAttempt?: number;
}

export interface QueueOptions<T> {
  maxConcurrent?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  getItemId?: (data: T) => string;
  onSuccess?: (data: T, result: any) => void;
  onError?: (data: T, error: Error, attempts: number) => void;
  onMaxRetries?: (data: T, error: Error, attempts: number) => void;
  processingTimeoutMs?: number;
}

/**
 * Enhanced queue implementation with prioritization, retry logic, and timeouts
 */
export class EnhancedQueue<T> {
  private queue: QueueItem<T>[] = [];
  private processing = false;
  private activeCount = 0;
  private readonly logger = new Logger(EnhancedQueue.name);
  private readonly options: Required<QueueOptions<T>>;
  private processingItems = new Map<string, { timeoutId?: NodeJS.Timeout }>();

  constructor(
    private readonly processor: (data: T) => Promise<any>,
    options?: QueueOptions<T>,
  ) {
    this.options = {
      maxConcurrent: 1,
      maxRetries: 3,
      retryDelayMs: 1000,
      getItemId: data => JSON.stringify(data),
      onSuccess: () => {},
      onError: () => {},
      onMaxRetries: () => {},
      processingTimeoutMs: 30000, // 30 seconds default timeout
      ...options,
    };
  }

  /**
   * Add an item to the queue
   */
  enqueue(data: T, priority: Priority = Priority.NORMAL): void {
    const id = this.options.getItemId(data);

    // Check if item with same ID is already in the queue
    const existingIndex = this.queue.findIndex(item => item.id === id);

    if (existingIndex >= 0) {
      // If new priority is higher, update the existing item
      if (priority < this.queue[existingIndex].priority) {
        this.queue[existingIndex].priority = priority;
        this.queue[existingIndex].createdAt = Date.now();
        this.sortQueue();
      }
      return;
    }

    const queueItem: QueueItem<T> = {
      id,
      data,
      priority,
      createdAt: Date.now(),
      attempts: 0,
    };

    this.queue.push(queueItem);
    this.sortQueue();
    this.processQueue();
  }

  /**
   * Add multiple items to the queue
   */
  enqueueMany(items: T[], priority: Priority = Priority.NORMAL): void {
    items.forEach(item => this.enqueue(item, priority));
  }

  /**
   * Sort the queue by priority and then by creation time
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Get the current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get the number of items currently being processed
   */
  processingCount(): number {
    return this.activeCount;
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Start/resume processing the queue
   */
  processQueue(): void {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    this.processNextBatch();
  }

  /**
   * Process the next batch of items
   */
  private async processNextBatch(): Promise<void> {
    if (this.queue.length === 0 || this.activeCount >= this.options.maxConcurrent) {
      if (this.activeCount === 0) {
        this.processing = false;
      }
      return;
    }

    // Get next item
    const item = this.queue.shift();
    if (!item) {
      if (this.activeCount === 0) {
        this.processing = false;
      }
      return;
    }

    // Start processing this item
    this.activeCount++;
    item.attempts++;
    item.lastAttempt = Date.now();

    // Set a timeout for this processing task
    const timeoutId = setTimeout(() => {
      this.handleTimeout(item);
    }, this.options.processingTimeoutMs);

    // Store reference to this processing item
    this.processingItems.set(item.id, { timeoutId });

    try {
      // Process concurrently
      this.processNextBatch();

      // Process the item
      const result = await this.processor(item.data);

      // Handle success
      this.clearTimeout(item.id);
      this.options.onSuccess(item.data, result);
    } catch (error) {
      // Handle error
      this.clearTimeout(item.id);
      this.options.onError(item.data, error as Error, item.attempts);

      // Retry logic
      if (item.attempts < this.options.maxRetries) {
        setTimeout(() => {
          this.queue.push(item);
          this.sortQueue();
          this.processQueue();
        }, this.options.retryDelayMs);
      } else {
        this.options.onMaxRetries(item.data, error as Error, item.attempts);
        this.logger.error(`Queue item ${item.id} failed after ${item.attempts} attempts: ${(error as Error).message}`);
      }
    } finally {
      // Cleanup and process next
      this.processingItems.delete(item.id);
      this.activeCount--;
      this.processNextBatch();
    }
  }

  /**
   * Handle a processing timeout
   */
  private handleTimeout(item: QueueItem<T>): void {
    this.processingItems.delete(item.id);

    const timeoutError = new Error(`Processing timeout after ${this.options.processingTimeoutMs}ms`);
    this.options.onError(item.data, timeoutError, item.attempts);

    // Re-queue if we haven't exceeded retry limit
    if (item.attempts < this.options.maxRetries) {
      this.queue.push(item);
      this.sortQueue();
    } else {
      this.options.onMaxRetries(item.data, timeoutError, item.attempts);
      this.logger.error(`Queue item ${item.id} timed out after ${item.attempts} attempts`);
    }
  }

  /**
   * Clear a timeout for a processing item
   */
  private clearTimeout(itemId: string): void {
    const item = this.processingItems.get(itemId);
    if (item?.timeoutId) {
      clearTimeout(item.timeoutId);
    }
  }
}
