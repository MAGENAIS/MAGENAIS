type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
}

export class Logger {
  private static level: LogLevel = 'info';
  private static levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  static configure(level: LogLevel) {
    this.level = level;
  }

  static debug(message: string, ...args: unknown[]) {
    this.log('debug', message, ...args);
  }

  static info(message: string, ...args: unknown[]) {
    this.log('info', message, ...args);
  }

  static warn(message: string, ...args: unknown[]) {
    this.log('warn', message, ...args);
  }

  static error(message: string, ...args: unknown[]) {
    this.log('error', message, ...args);
  }

  private static log(level: LogLevel, message: string, ...args: unknown[]) {
    if (this.levels[level] < this.levels[this.level]) return;
    const prefix = `[${level.toUpperCase()}]`;
    console[level === 'debug' ? 'log' : level](prefix, message, ...args);
  }
}
