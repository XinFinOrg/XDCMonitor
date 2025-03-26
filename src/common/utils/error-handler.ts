import { Logger } from '@nestjs/common';

/**
 * Base class for application errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly metadata?: Record<string, any>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get a string representation of the error
   */
  toString(): string {
    return `${this.name}(${this.code}): ${this.message}`;
  }

  /**
   * Convert to an object for logging or API responses
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      metadata: this.metadata,
      stack: this.stack,
    };
  }
}

/**
 * Error for RPC-related issues
 */
export class RpcError extends AppError {
  constructor(
    message: string,
    public readonly endpoint?: string,
    public readonly method?: string,
    metadata?: Record<string, any>,
  ) {
    super(message, 'RPC_ERROR', { ...metadata, endpoint, method });
  }
}

/**
 * Error for blockchain monitoring issues
 */
export class BlockchainError extends AppError {
  constructor(
    message: string,
    public readonly network?: string,
    public readonly blockNumber?: number,
    metadata?: Record<string, any>,
  ) {
    super(message, 'BLOCKCHAIN_ERROR', { ...metadata, network, blockNumber });
  }
}

/**
 * Error for configuration issues
 */
export class ConfigurationError extends AppError {
  constructor(
    message: string,
    public readonly configKey?: string,
    metadata?: Record<string, any>,
  ) {
    super(message, 'CONFIGURATION_ERROR', { ...metadata, configKey });
  }
}

/**
 * Error for validation issues
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: any,
    metadata?: Record<string, any>,
  ) {
    super(message, 'VALIDATION_ERROR', { ...metadata, field, value });
  }
}

/**
 * Error for database/storage issues
 */
export class StorageError extends AppError {
  constructor(
    message: string,
    public readonly operation?: string,
    metadata?: Record<string, any>,
  ) {
    super(message, 'STORAGE_ERROR', { ...metadata, operation });
  }
}

/**
 * Utility class for consistent error handling across the application
 */
export class ErrorHandler {
  private readonly logger: Logger;

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  /**
   * Log and wrap an error if it's not already an AppError
   */
  handleError(error: any, defaultMessage = 'An unexpected error occurred', metadata?: Record<string, any>): AppError {
    // If it's already an AppError, just log it and return
    if (error instanceof AppError) {
      this.logger.error(`${error.name}(${error.code}): ${error.message}`, error.stack);
      return error;
    }

    // Create a generic AppError with additional info
    const message = error?.message || defaultMessage;
    const appError = new AppError(message, 'UNKNOWN_ERROR', {
      ...metadata,
      originalError: error?.toString ? error.toString() : String(error),
    });

    this.logger.error(`${appError.name}(${appError.code}): ${appError.message}`, appError.stack);
    return appError;
  }

  /**
   * Create and log a specific RPC error
   */
  handleRpcError(message: string, endpoint?: string, method?: string, metadata?: Record<string, any>): RpcError {
    const error = new RpcError(message, endpoint, method, metadata);
    this.logger.error(
      `${error.name}(${error.code}): ${message} [endpoint: ${endpoint || 'unknown'}, method: ${method || 'unknown'}]`,
      error.stack,
    );
    return error;
  }

  /**
   * Create and log a specific blockchain error
   */
  handleBlockchainError(
    message: string,
    network?: string,
    blockNumber?: number,
    metadata?: Record<string, any>,
  ): BlockchainError {
    const error = new BlockchainError(message, network, blockNumber, metadata);
    this.logger.error(
      `${error.name}(${error.code}): ${message} [network: ${network || 'unknown'}, block: ${
        blockNumber !== undefined ? blockNumber : 'unknown'
      }]`,
      error.stack,
    );
    return error;
  }

  /**
   * Create and log a specific configuration error
   */
  handleConfigError(message: string, configKey?: string, metadata?: Record<string, any>): ConfigurationError {
    const error = new ConfigurationError(message, configKey, metadata);
    this.logger.error(`${error.name}(${error.code}): ${message} [config key: ${configKey || 'unknown'}]`, error.stack);
    return error;
  }

  /**
   * Create and log a specific validation error
   */
  handleValidationError(message: string, field?: string, value?: any, metadata?: Record<string, any>): ValidationError {
    const error = new ValidationError(message, field, value, metadata);
    this.logger.error(`${error.name}(${error.code}): ${message} [field: ${field || 'unknown'}]`, error.stack);
    return error;
  }

  /**
   * Create and log a specific storage error
   */
  handleStorageError(message: string, operation?: string, metadata?: Record<string, any>): StorageError {
    const error = new StorageError(message, operation, metadata);
    this.logger.error(`${error.name}(${error.code}): ${message} [operation: ${operation || 'unknown'}]`, error.stack);
    return error;
  }
}
