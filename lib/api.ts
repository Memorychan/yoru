export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) && !(options.body instanceof Blob)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });
  const result = await response
    .json()
    .catch(() => ({ message: 'The server could not be reached.' }));
  if (!response.ok)
    throw new Error(
      Array.isArray(result.message)
        ? result.message.join(', ')
        : result.message || 'Something went wrong.',
    );
  return result;
}
export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100);
export const duration = (seconds: number) =>
  seconds ? `${Math.floor(seconds / 60)}m` : 'Coming soon';
