import { Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';

/**
 * Configuration options for RPC retry behavior
 */
export interface RpcRetryOptions {
  /**
   * Maximum number of retry attempts (default: 3)
   */
  maxRetries?: number;

  /**
   * Delay between retries in milliseconds (default: 1000ms)
   */
  retryDelayMs?: number;

  /**
   * Whether to use exponential backoff for retries (default: true)
   */
  useExponentialBackoff?: boolean;

  /**
   * Factor for exponential backoff calculation (default: 2)
   */
  backoffFactor?: number;

  /**
   * Maximum timeout for RPC requests in milliseconds (default: 30000ms)
   */
  timeoutMs?: number;

  /**
   * Fallback URLs to try if primary URL fails (optional)
   */
  fallbackUrls?: string[];
}

/**
 * RPC method request payload
 */
export interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number | string;
}

/**
 * RPC method response
 */
export interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * A resilient RPC client with retry and fallback capabilities
 */
export class RpcRetryClient {
  private readonly logger = new Logger(RpcRetryClient.name);
  private readonly options: Required<Omit<RpcRetryOptions, 'fallbackUrls'>> & { fallbackUrls: string[] };
  private requestId = 1;
  private primaryUrl: string;

  /**
   * Creates a new RPC retry client
   * @param primaryUrl Primary RPC endpoint URL
   * @param options Configuration options
   */
  constructor(primaryUrl: string, options?: RpcRetryOptions) {
    this.primaryUrl = primaryUrl;
    this.options = {
      maxRetries: options?.maxRetries ?? 3,
      retryDelayMs: options?.retryDelayMs ?? 1000,
      useExponentialBackoff: options?.useExponentialBackoff ?? true,
      backoffFactor: options?.backoffFactor ?? 2,
      timeoutMs: options?.timeoutMs ?? 30000,
      fallbackUrls: options?.fallbackUrls ?? [],
    };
  }

  /**
   * Call an RPC method with retry and fallback logic
   * @param method The RPC method name
   * @param params Parameters for the method
   * @param customOptions Optional request-specific options
   * @returns The RPC response
   */
  async call<T = any>(method: string, params: any[] = [], customOptions?: Partial<RpcRetryOptions>): Promise<T> {
    const options = { ...this.options, ...customOptions };
    const urls = [this.primaryUrl, ...options.fallbackUrls];

    let lastError: Error | null = null;

    // Try each URL in sequence
    for (const url of urls) {
      try {
        const result = await this.callWithRetry<T>(url, method, params, options);
        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(`Failed to call ${method} on ${url}: ${error.message}`);

        // If this is the last URL, don't swallow the error
        if (url === urls[urls.length - 1]) {
          throw error;
        }

        // Otherwise, try the next URL
        this.logger.debug(`Trying fallback URL for ${method}`);
      }
    }

    // This should never happen, but TypeScript needs it
    throw lastError || new Error(`Failed to call ${method}`);
  }

  /**
   * Call an RPC method on a specific URL with retry logic
   * @param url The RPC endpoint URL
   * @param method The RPC method name
   * @param params Parameters for the method
   * @param options Configuration options
   * @returns The RPC response
   */
  private async callWithRetry<T = any>(
    url: string,
    method: string,
    params: any[],
    options: Required<Omit<RpcRetryOptions, 'fallbackUrls'>> & { fallbackUrls: string[] },
  ): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < options.maxRetries) {
      try {
        const result = await this.executeRpcCall<T>(url, method, params, options);
        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        // If this is our last retry, don't delay, just throw
        if (attempt >= options.maxRetries) {
          throw error;
        }

        // Calculate delay with optional exponential backoff
        const delay = options.useExponentialBackoff
          ? options.retryDelayMs * Math.pow(options.backoffFactor, attempt - 1)
          : options.retryDelayMs;

        this.logger.debug(
          `Retry attempt ${attempt}/${options.maxRetries} for ${method} on ${url} after ${delay}ms: ${error.message}`,
        );

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This should never happen, but TypeScript needs it
    throw lastError || new Error(`Failed to call ${method} after ${options.maxRetries} attempts`);
  }

  /**
   * Execute a single RPC call
   * @param url The RPC endpoint URL
   * @param method The RPC method name
   * @param params Parameters for the method
   * @param options Configuration options
   * @returns The RPC response
   */
  private async executeRpcCall<T = any>(
    url: string,
    method: string,
    params: any[],
    options: { timeoutMs: number },
  ): Promise<T> {
    const requestId = this.requestId++;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: requestId,
    };

    const config: AxiosRequestConfig = {
      timeout: options.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    };

    const startTime = Date.now();

    try {
      const response = await axios.post<JsonRpcResponse>(url, request, config);
      const responseTime = Date.now() - startTime;

      this.logger.debug(`RPC call ${method} on ${url} completed in ${responseTime}ms`);

      if (response.data.error) {
        throw new Error(`RPC error: ${response.data.error.message} (code: ${response.data.error.code})`);
      }

      return response.data.result;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error.response) {
        // The request was made and the server responded with a non-2xx status
        throw new Error(`HTTP error ${error.response.status}: ${error.response.statusText}`);
      } else if (error.request) {
        // The request was made but no response was received
        throw new Error(`No response received (timeout: ${responseTime}ms)`);
      } else {
        // Something happened in setting up the request
        throw error;
      }
    }
  }

  /**
   * Set a new primary URL
   * @param url The new primary URL
   */
  setPrimaryUrl(url: string): void {
    this.primaryUrl = url;
  }

  /**
   * Set fallback URLs
   * @param urls Array of fallback URLs
   */
  setFallbackUrls(urls: string[]): void {
    this.options.fallbackUrls = urls;
  }

  /**
   * Add a fallback URL
   * @param url Fallback URL to add
   */
  addFallbackUrl(url: string): void {
    if (!this.options.fallbackUrls.includes(url)) {
      this.options.fallbackUrls.push(url);
    }
  }

  /**
   * Clear all fallback URLs
   */
  clearFallbackUrls(): void {
    this.options.fallbackUrls = [];
  }
}
