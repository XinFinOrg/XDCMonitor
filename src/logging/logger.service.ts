import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

export interface CustomLoggerOptions {
  enableFileLogging?: boolean;
  enableConsoleLogging?: boolean;
  logDirectory?: string;
  maxFiles?: number;
  maxFileSize?: string;
}

@Injectable()
export class CustomLoggerService implements LoggerService {
  private winstonLogger: winston.Logger;
  private logDirectory: string;
  private context = 'CustomLogger';

  constructor(private readonly configService?: ConfigService) {
    this.logDirectory = path.join(process.cwd(), 'logs');
    this.ensureLogDirectory();
    this.initializeWinstonLogger();
  }

  /**
   * Ensure the logs directory exists
   */
  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
      console.log(`Created logs directory: ${this.logDirectory}`);
    }
  }

  /**
   * Initialize Winston logger with file and console transports
   */
  private initializeWinstonLogger(): void {
    const logLevel = this.configService?.getLogLevel() || process.env.LOG_LEVEL || 'info';

    // Create daily log directory structure: logs/YYYY-MM-DD/
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const dailyLogDirectory = path.join(this.logDirectory, today);

    // Ensure the daily log directory exists
    if (!fs.existsSync(dailyLogDirectory)) {
      fs.mkdirSync(dailyLogDirectory, { recursive: true });
      console.log(`Created daily logs directory: ${dailyLogDirectory}`);
    }

    // Custom format for logs
    const customFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, context, stack, ...meta }) => {
        const contextStr = context ? `[${context}] ` : '';
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const stackStr = stack ? `\n${stack}` : '';
        return `${timestamp} [${level.toUpperCase()}] ${contextStr}${message}${metaStr}${stackStr}`;
      }),
    );

    // Console format with colors
    const consoleFormat = winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, context, stack, ...meta }) => {
        const contextStr = context ? `[${context}] ` : '';
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const stackStr = stack ? `\n${stack}` : '';
        return `${timestamp} ${level} ${contextStr}${message}${metaStr}${stackStr}`;
      }),
    );

    // Create transports with daily directory structure
    const transports: winston.transport[] = [
      // Console transport
      new winston.transports.Console({
        level: logLevel,
        format: consoleFormat,
        handleExceptions: true,
        handleRejections: true,
      }),

      // Combined logs file (all levels) - daily file
      new winston.transports.File({
        filename: path.join(dailyLogDirectory, 'combined.log'),
        level: logLevel,
        format: customFormat,
        handleExceptions: true,
        handleRejections: true,
      }),

      // Error logs file (errors only) - daily file
      new winston.transports.File({
        filename: path.join(dailyLogDirectory, 'error.log'),
        level: 'error',
        format: customFormat,
        handleExceptions: true,
        handleRejections: true,
      }),

      // App-specific logs - daily file
      new winston.transports.File({
        filename: path.join(dailyLogDirectory, 'app.log'),
        level: logLevel,
        format: customFormat,
      }),

      // Debug logs (only when log level is debug) - daily file
      ...(logLevel === 'debug'
        ? [
            new winston.transports.File({
              filename: path.join(dailyLogDirectory, 'debug.log'),
              level: 'debug',
              format: customFormat,
            }),
          ]
        : []),
    ];

    // Create the Winston logger
    this.winstonLogger = winston.createLogger({
      level: logLevel,
      transports,
      exitOnError: false,
    });

    // Handle uncaught exceptions and unhandled promise rejections - daily files
    this.winstonLogger.exceptions.handle(
      new winston.transports.File({
        filename: path.join(dailyLogDirectory, 'exceptions.log'),
        format: customFormat,
      }),
    );

    this.winstonLogger.rejections.handle(
      new winston.transports.File({
        filename: path.join(dailyLogDirectory, 'rejections.log'),
        format: customFormat,
      }),
    );

    this.log(`Logger initialized with level: ${logLevel}`, this.context);
    this.log(`Daily logs directory: ${dailyLogDirectory}`, this.context);
    this.log(`Logs root directory: ${this.logDirectory}`, this.context);
  }

  /**
   * Log a message at any level
   */
  log(message: any, context?: string): void {
    const contextName = context || this.context;
    this.winstonLogger.info(message, { context: contextName });
  }

  /**
   * Log an error message
   */
  error(message: any, stack?: string, context?: string): void {
    const contextName = context || this.context;

    if (stack) {
      this.winstonLogger.error(message, { context: contextName, stack });
    } else if (message instanceof Error) {
      this.winstonLogger.error(message.message, { context: contextName, stack: message.stack });
    } else {
      this.winstonLogger.error(message, { context: contextName });
    }
  }

  /**
   * Log a warning message
   */
  warn(message: any, context?: string): void {
    const contextName = context || this.context;
    this.winstonLogger.warn(message, { context: contextName });
  }

  /**
   * Log a debug message
   */
  debug(message: any, context?: string): void {
    const contextName = context || this.context;
    this.winstonLogger.debug(message, { context: contextName });
  }

  /**
   * Log a verbose message
   */
  verbose(message: any, context?: string): void {
    const contextName = context || this.context;
    this.winstonLogger.verbose(message, { context: contextName });
  }

  /**
   * Set log levels (for compatibility with NestJS)
   */
  setLogLevels(levels: LogLevel[]): void {
    // This method is required by the LoggerService interface
    // Winston handles levels differently, so we don't need to implement this
  }

  /**
   * Get a child logger with a specific context
   */
  getChildLogger(context: string): CustomLoggerService {
    const childLogger = new CustomLoggerService(this.configService);
    childLogger.context = context;
    return childLogger;
  }

  /**
   * Get the Winston logger instance for advanced usage
   */
  getWinstonLogger(): winston.Logger {
    return this.winstonLogger;
  }

  /**
   * Log application startup information
   */
  logStartupInfo(port: number, environment: string): void {
    this.log('='.repeat(60), this.context);
    this.log('🚀 XDC MONITOR APPLICATION STARTED', this.context);
    this.log('='.repeat(60), this.context);
    this.log(`📍 Port: ${port}`, this.context);
    this.log(`🌍 Environment: ${environment}`, this.context);
    this.log(`📂 Logs Directory: ${this.logDirectory}`, this.context);
    this.log(`📊 Log Level: ${this.winstonLogger.level}`, this.context);
    this.log(`⏰ Started at: ${new Date().toISOString()}`, this.context);
    this.log('='.repeat(60), this.context);
  }

  /**
   * Log application shutdown information
   */
  logShutdownInfo(): void {
    this.log('='.repeat(60), this.context);
    this.log('🛑 XDC MONITOR APPLICATION SHUTTING DOWN', this.context);
    this.log(`⏰ Shutdown at: ${new Date().toISOString()}`, this.context);
    this.log('='.repeat(60), this.context);
  }

  /**
   * Log monitoring activity
   */
  logMonitoringActivity(component: string, message: string, metadata?: any): void {
    const fullMessage = `[${component}] ${message}${metadata ? ` ${JSON.stringify(metadata)}` : ''}`;
    this.log(fullMessage, 'MONITORING');
  }

  /**
   * Log RPC activity
   */
  logRpcActivity(endpoint: string, message: string, latency?: number): void {
    const latencyStr = latency ? ` (${latency}ms)` : '';
    this.log(`[RPC] ${endpoint}: ${message}${latencyStr}`, 'RPC');
  }

  /**
   * Log blockchain activity
   */
  logBlockchainActivity(chainId: number, message: string, metadata?: any): void {
    const fullMessage = `[Chain ${chainId}] ${message}${metadata ? ` ${JSON.stringify(metadata)}` : ''}`;
    this.log(fullMessage, 'BLOCKCHAIN');
  }

  /**
   * Log metrics activity
   */
  logMetrics(message: string, metadata?: any): void {
    const fullMessage = `${message}${metadata ? ` ${JSON.stringify(metadata)}` : ''}`;
    this.log(fullMessage, 'METRICS');
  }

  /**
   * Log alert activity
   */
  logAlert(severity: string, component: string, message: string, metadata?: any): void {
    const fullMessage = `[ALERT:${severity.toUpperCase()}] [${component}] ${message}${metadata ? ` ${JSON.stringify(metadata)}` : ''}`;

    if (severity === 'error') {
      this.error(fullMessage, undefined, 'ALERTS');
    } else if (severity === 'warn') {
      this.warn(fullMessage, 'ALERTS');
    } else {
      this.log(fullMessage, 'ALERTS');
    }
  }
}
