// Keep diagnostics useful without logging credentials, query parameters or record contents.
export function connectionReason(error: unknown): string {
  const value = error as { code?: string; errorCode?: string; message?: string };
  const message = String(value?.message || '');
  const code = String(value?.code || value?.errorCode || '');
  if (/^(P\d{4}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/.test(code)) return code;
  if (/max.*requests|quota|rate.limit/i.test(message))
    return 'Provider request quota or rate limit reached';
  if (/WRONGPASS|NOAUTH/i.test(message)) return 'Redis authentication rejected';
  if (/missing lock|lock mismatch|could not renew lock/i.test(message))
    return 'Queue job lock was lost';
  if (/stalled/i.test(message)) return 'Queue job stalled';
  if (/timeout|timed out/i.test(message)) return 'Connection/command timed out';
  if (/closed|not writeable|retry|connect/i.test(message)) return 'Connection unavailable';
  return 'Service request failed';
}
