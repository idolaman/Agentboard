import { createHash } from 'node:crypto';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelToNum: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getEnvLevel(): LogLevel {
  const raw = String(process.env.THINKING_LOG_LEVEL || 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

function safeStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, val) => {
    if (val instanceof Error) {
      return { message: val.message, name: val.name, stack: val.stack };
    }
    return val;
  }, space);
}

const serviceName = process.env.THINKING_LOG_SERVICE || 'thinking-logger';

// Only display usage logs (see isUsageEvent) and errors. Suppress debug/info/warn non-usage.
const usageOnly: boolean = (process.env.THINKING_LOG_USAGE_ONLY || 'true').toLowerCase() !== 'false';
// Always prettify output for readability.
const prettyOutput: boolean = true;

function isUsageEvent(event: string): boolean {
  if (event.startsWith('tool.')) return true;
  switch (event) {
    case 'hook.event':
    case 'session.open':
    case 'session.closed':
    case 'session.terminate':
    case 'sse.open':
      return true;
    default:
      return false;
  }
}

function shouldLog(current: LogLevel, level: LogLevel): boolean {
  return levelToNum[level] >= levelToNum[current];
}

function baseLog(level: LogLevel, event: string, fields?: Record<string, unknown>, msg?: string) {
  if (usageOnly) {
    const isUsage = isUsageEvent(event);
    if (level !== 'error' && !isUsage) {
      return; // suppress non-usage logs unless error
    }
  }
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    service: serviceName,
    pid: process.pid,
    ...fields,
  };
  if (msg) record.msg = msg;
  const line = safeStringify(record, prettyOutput ? 2 : undefined);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else if (level === 'debug') {
    // Some environments do not surface console.debug; fall back to log
    (console.debug || console.log).call(console, line);
  } else {
    console.log(line);
  }
}

const currentLevel: LogLevel = getEnvLevel();

export const logger = {
  level: currentLevel as LogLevel,
  debug(event: string, fields?: Record<string, unknown>, msg?: string) {
    if (!shouldLog(currentLevel, 'debug')) return;
    baseLog('debug', event, fields, msg);
  },
  info(event: string, fields?: Record<string, unknown>, msg?: string) {
    if (!shouldLog(currentLevel, 'info')) return;
    baseLog('info', event, fields, msg);
  },
  warn(event: string, fields?: Record<string, unknown>, msg?: string) {
    if (!shouldLog(currentLevel, 'warn')) return;
    baseLog('warn', event, fields, msg);
  },
  error(event: string, fields?: Record<string, unknown>, msg?: string) {
    if (!shouldLog(currentLevel, 'error')) return;
    baseLog('error', event, fields, msg);
  },
} as const;

export function fingerprintToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

