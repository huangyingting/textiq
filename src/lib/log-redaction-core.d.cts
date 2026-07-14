declare const redaction: {
  readonly REDACTED: "[redacted]";
  normalizeLogKey(key: string): string;
  isSensitiveKey(key: string): boolean;
  isContentKey(key: string): boolean;
  redactContext(context?: Record<string, unknown>): Record<string, unknown>;
  isUnsafeLogString(value: string): boolean;
  sanitizeLogString(value: string): string;
  isSafeTelemetryScalar(value: unknown): value is string | number | boolean;
  buildSafeTelemetryContext(
    context?: Record<string, unknown>,
  ): Record<string, string | number | boolean>;
  normalizeErrorForLog(error: unknown): {
    errorName: string;
    message: string;
    stack?: string;
  };
  buildLogRecord<
    TLevel extends string,
    TFields extends Record<string, unknown> = Record<string, unknown>,
  >(params: {
    level: TLevel;
    scope: string;
    context?: Record<string, unknown>;
    fields?: TFields;
  }): { level: TLevel; scope: string; timestamp: string } & Record<
    string,
    unknown
  > &
    TFields;
};

export = redaction;
