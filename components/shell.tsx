'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import {
  Search,
  Compass,
  Bookmark,
  Library,
  Settings2,
  LogOut,
  Menu,
  X,
  Moon,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import type { User } from '@/lib/types';
import { api, post } from '@/lib/api';
import { Loading, ErrorBox } from './ui';
const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext);
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Yoru home">
      <span className="brand-symbol">
        <img src="/yoru-logo.png" width={32} height={32} alt="" />
      </span>
      yoru<span className="brand-dot">.</span>
    </Link>
  );
}
export function Shell({ children, preview = false }: { children: ReactNode; preview?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useEffect(() => {
    if (preview) return;
    api<User>('/auth/me')
      .then(setUser)
      .catch((e) => {
        if (e.message.includes('session') || e.message.includes('Sign in'))
          router.replace('/login');
        else
          setError('The server is unavailable. Start the API, PostgreSQL and Redis, then refresh.');
      });
  }, [preview, router]);
  useEffect(() => setMenu(false), [pathname]);
  if (!preview && !user)
    return (
      <div className="boot">
        <Brand />
        {error ? <ErrorBox message={error} retry={() => location.reload()} /> : <Loading />}
        <Link className="text-button" href="/preview">
          View the design preview
        </Link>
      </div>
    );
  return (
    <UserContext.Provider value={user}>
      <header className="topbar">
        <Brand />
        <nav className={menu ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
          <Link
            className={pathname === '/' || preview ? 'active' : ''}
            href={preview ? '/preview' : '/'}
          >
            Discover
          </Link>
          <Link className={pathname === '/browse' ? 'active' : ''} href="/browse">
            Browse
          </Link>
          <Link href="/browse?category=ANIME">Anime</Link>
          <Link href="/browse?category=CARTOON">Cartoons</Link>
          <Link href="/browse?category=LIVE_ACTION">Live action</Link>
          <Link className={pathname === '/library' ? 'active' : ''} href="/library">
            My library
          </Link>
        </nav>
        <div className="header-actions">
          <form
            className="search-mini"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/browse?q=${encodeURIComponent(search)}`);
            }}
          >
            <Search size={17} />
            <input
              ref={searchInput}
              aria-label="Search titles"
              placeholder="Find your next story"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </form>
          {preview ? (
            <Link className="button small primary" href="/login">
              Sign in
            </Link>
          ) : (
            <Link className="avatar" href="/account" aria-label="Your account">
              {user?.name.slice(0, 1).toUpperCase()}
            </Link>
          )}
          <button
            className="mobile-menu icon-button"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main className="main-content">{children}</main>
      <footer className="footer">
        <Brand />
        <span>A little escape. A shared universe.</span>
        <div>
          {user?.role === 'ADMIN' && (
            <Link href="/admin">
              <Settings2 size={15} />
              Admin studio
            </Link>
          )}
          <span className="private-label">
            <span />
            Your private circle
          </span>
        </div>
      </footer>
      {preview && (
        <div className="preview-ribbon">
          <Sparkles size={15} /> Design preview · Original sample artwork, no playable media{' '}
          <Link href="/login">Open your circle</Link>
        </div>
      )}
    </UserContext.Provider>
  );
}
