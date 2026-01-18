export type OmniMeta = {
  requestId?: string;
  timestamp: string;
  tempId?: string;
};

export type OmniError = {
  code: string;
  details?: unknown;
  statusCode?: number;
};

export type OmniResponse<T = unknown> = {
  success: boolean;
  message: string;
  data?: T;
  error?: OmniError;
  meta: OmniMeta;
};

export function ok<T>(
  message: string,
  data?: T,
  meta?: Partial<OmniMeta>,
): OmniResponse<T> {
  return {
    success: true,
    message,
    data,
    meta: { timestamp: new Date().toISOString(), ...meta },
  };
}

export function fail(
  message: string,
  error: OmniError,
  meta?: Partial<OmniMeta>,
): OmniResponse<never> {
  return {
    success: false,
    message,
    error,
    meta: { timestamp: new Date().toISOString(), ...meta },
  };
}
