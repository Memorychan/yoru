'use client';
import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { AlertCircle, Loader2, X, Film } from 'lucide-react';
import { api } from '@/lib/api';
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const inFlight = useRef(false);
  const reload = useCallback(() => {
    if (!inFlight.current) setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    inFlight.current = true;
    setLoading(true);
    setError('');
    api<T>(path, { signal: controller.signal })
      .then((x) => {
        if (active) setData(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          inFlight.current = false;
        }
      });
    return () => {
      active = false;
      inFlight.current = false;
      controller.abort();
    };
  }, [path, version]);
  return { data, error, loading, reload, setData };
}
export function Loading() {
  return (
    <div className="loading">
      <Loader2 className="spin" size={24} />
      <span>Finding your next story…</span>
    </div>
  );
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <span>{message}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Film size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selector =
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
    dialog.current?.querySelector<HTMLElement>(selector)?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const items = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(selector) || [],
        ).filter((item) => item.getClientRects().length > 0);
        const first = items[0],
          last = items[items.length - 1];
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first || !dialog.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener('keydown', handler);
      previousFocus?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Close dialog">
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
