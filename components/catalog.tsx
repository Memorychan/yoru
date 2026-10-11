'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Play,
  Plus,
  Check,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Sparkles,
  LockKeyhole,
  Bookmark,
} from 'lucide-react';
import type { Title, Library, Collection } from '@/lib/types';
import { duration, money, post } from '@/lib/api';
import { showcase } from '@/lib/showcase';
import { Shell, useUser } from './shell';
import { useData, Loading, ErrorBox, Empty } from './ui';
export function AccessBadge({ title }: { title: Title }) {
  const p = title.products[0];
  return (
    <span className={`access-badge ${p?.mode === 'FREE' ? 'free' : ''}`}>
      {title.showcase
        ? 'Preview'
        : !p || p.mode === 'FREE'
          ? 'Included'
          : p.mode === 'RENTAL'
            ? `Rent ${money(p.pricePaise)}`
            : money(p.pricePaise)}
    </span>
  );
}
export function Card({ title, index }: { title: Title; index?: number }) {
  return (
    <Link
      href={title.id.startsWith('preview-') ? '/login' : `/title/${title.id}`}
      className={`title-card variant-${(index || 0) % 3}`}
    >
      <div className="poster">
        <img src={title.poster} alt="" loading="lazy" />
        <div className="poster-shade" />
        <AccessBadge title={title} />
        <div className="poster-play">
          <Play size={23} fill="currentColor" />
        </div>
        <span className="poster-category">
          {title.category === 'ANIME'
            ? 'ANIME'
            : title.category === 'CARTOON'
              ? 'ANIMATION'
              : 'LIVE ACTION'}
        </span>
      </div>
      <h3>{title.name}</h3>
      <p>
        {title.year}
        <span>·</span>
        {title.format === 'SERIES' ? 'Series' : 'Movie'}
        <span>·</span>
        {title.genres[0]}
      </p>
    </Link>
  );
}
function Shelf({ title, subtitle, items }: { title: string; subtitle?: string; items: Title[] }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = () => {
    const el = row.current;
    if (el)
      setEdges({
        start: el.scrollLeft < 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
  };
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, [items.length]);
  return (
    <section className="shelf">
      <div className="section-heading">
        <div>
          <h2>
            {title}
            <span className="accent-dot">.</span>
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="shelf-controls">
          <button
            className="icon-button"
            aria-label={`Previous ${title}`}
            onClick={() =>
              row.current?.scrollBy({ left: -row.current.clientWidth * 0.8, behavior: 'smooth' })
            }
            disabled={edges.start}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="icon-button"
            aria-label={`Next ${title}`}
            onClick={() =>
              row.current?.scrollBy({ left: row.current.clientWidth * 0.8, behavior: 'smooth' })
            }
            disabled={edges.end}
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </div>
      <div
        className="card-row"
        ref={row}
        onScroll={update}
        style={{ overflowX: 'auto', scrollbarWidth: 'none', transform: 'none' }}
      >
        {items.map((item, i) => (
          <Card key={item.id} title={item} index={i} />
        ))}
      </div>
    </section>
  );
}
function Hero({
  title,
  preview = false,
  saved = false,
  onSave,
  slide = 0,
  count = 1,
  onSlide,
}: {
  title: Title;
  preview?: boolean;
  saved?: boolean;
  onSave?: () => Promise<void>;
  slide?: number;
  count?: number;
  onSlide?: (offset: number) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="hero">
      <img className="hero-art" src={title.backdrop} alt="" fetchPriority="high" />
      <div className="hero-vignette" />
      <div className="hero-content">
        <div className="eyebrow">
          <span className="eyebrow-line" />
          THE EVENING PICK{' '}
          <span className="outline-pill">{title.format === 'MOVIE' ? 'FILM' : 'SERIES'}</span>
        </div>
        <h1>
          {title.name === 'Beyond the Blue' ? (
            <>
              Beyond
              <br />
              the <em>Blue.</em>
            </>
          ) : (
            title.name
          )}
        </h1>
        <div className="hero-meta">
          <span>{title.year}</span>
          <span>{title.genres.slice(0, 2).join(' / ')}</span>
          <span className="rating">{title.ageRating}</span>
          <span className="quality">HD</span>
        </div>
        <p>{title.synopsis}</p>
        <div className="hero-actions">
          <Link className="button primary" href={preview ? '/login' : `/title/${title.id}`}>
            <Play size={18} fill="currentColor" />
            {title.showcase ? 'Explore the story' : 'Discover this title'}
          </Link>
          {preview ? (
            <Link className="button glass" href="/login">
              <Plus size={20} /> My watchlist
            </Link>
          ) : (
            <button
              className="button glass"
              disabled={saving || !onSave}
              onClick={async () => {
                setSaving(true);
                setError('');
                try {
                  await onSave?.();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saved ? <Check size={20} /> : <Plus size={20} />}
              {saved ? 'In your watchlist' : 'My watchlist'}
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="hero-caption">
          <span>YOUR NEXT GREAT ESCAPE</span>
          <span className="fine-rule" />
        </div>
      </div>
      <div className="hero-bottom">
        <span>
          <i /> CURATED FOR YOUR CIRCLE
        </span>
        <span>
          {count > 1 && (
            <button
              className="icon-button"
              aria-label="Previous featured title"
              onClick={() => onSlide?.(-1)}
            >
              <ChevronLeft size={19} />
            </button>
          )}
          {String(slide + 1).padStart(2, '0')}{' '}
          <span className="muted">/ {String(count).padStart(2, '0')}</span>
          {count > 1 && (
            <button
              className="icon-button"
              aria-label="Next featured title"
              onClick={() => onSlide?.(1)}
            >
              <ChevronRight size={19} />
            </button>
          )}
          <span className="hero-progress" />
        </span>
      </div>
    </section>
  );
}
function HomeContent({ preview = false }: { preview?: boolean }) {
  const catalog = useData<Title[]>(preview ? null : '/catalog');
  const collections = useData<Collection[]>(preview ? null : '/collections');
  const library = useData<Library>(preview ? null : '/library');
  const user = useUser();
  const titles = preview
    ? showcase.map((t) => ({ ...t, id: `preview-${t.id}` }))
    : catalog.data || [];
  const [filter, setFilter] = useState('All stories');
  const [slide, setSlide] = useState(0);
  const featured = titles.filter((title) => title.featured);
  const collectionIds = [
    ...new Set(
      (collections.data || []).flatMap((collection) =>
        collection.items.map((item) => item.titleId),
      ),
    ),
  ];
  const curated = collectionIds
    .map((id) => titles.find((title) => title.id === id))
    .filter((title): title is Title => !!title);
  const slides = curated.length ? curated : featured.length ? featured : titles;
  const slideIndex = slides.length ? slide % slides.length : 0;
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => {
      if (document.hidden || document.querySelector('.hero:hover, .hero:focus-within')) return;
      setSlide((value) => (value + 1) % slides.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [slides.length]);
  const filtered = titles.filter(
    (t) =>
      filter === 'All stories' ||
      (filter === 'Anime' && t.category === 'ANIME') ||
      (filter === 'Cartoons' && t.category === 'CARTOON') ||
      (filter === 'Movies' && t.format === 'MOVIE') ||
      (filter === 'Series' && t.format === 'SERIES'),
  );
  if (!preview && catalog.loading) return <Loading />;
  if (catalog.error) return <ErrorBox message={catalog.error} retry={catalog.reload} />;
  const hero = slides[slideIndex];
  return (
    <>
      {hero ? (
        <Hero
          key={hero.id}
          title={hero}
          slide={slideIndex}
          count={slides.length}
          onSlide={(offset) => setSlide((slideIndex + offset + slides.length) % slides.length)}
          preview={preview}
          saved={library.data?.saved.includes(hero.id)}
          onSave={
            library.data
              ? async () => {
                  await post(`/saved/${hero.id}`, {
                    saved: !library.data?.saved.includes(hero.id),
                  });
                  library.reload();
                }
              : undefined
          }
        />
      ) : (
        <div className="page">
          <Empty title="Your universe starts here">
            Your admin can add the first movie or series in the studio.
          </Empty>
        </div>
      )}
      <div className="home-body">
        <div className="welcome-row">
          <div>
            <span className="eyebrow muted">THE GOOD PART OF YOUR DAY</span>
            <h2>Something worth staying in for.</h2>
          </div>
          <span className="circle-note">
            <Sparkles size={16} /> A collection for you & your people
          </span>
        </div>
        <div className="filter-tabs">
          {['All stories', 'Anime', 'Cartoons', 'Movies', 'Series'].map((f) => (
            <button className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)} key={f}>
              {f}
            </button>
          ))}
          <Link href="/browse" className="browse-all">
            Explore all <ArrowUpRight size={16} />
          </Link>
        </div>
        {library.data?.progress.some(
          (p) => p.seconds > 0 && p.seconds < p.episode.duration - 20,
        ) && (
          <section className="shelf">
            <div className="section-heading">
              <h2>
                Pick up where you left off<span className="accent-dot">.</span>
              </h2>
            </div>
            <div className="continue-row">
              {library.data.progress
                .filter((p) => p.seconds > 0 && p.seconds < p.episode.duration - 20)
                .slice(0, 4)
                .map((p) => (
                  <Link
                    className="continue-card"
                    href={`/watch/${p.episode.id}`}
                    key={p.episode.id}
                  >
                    <img src={p.episode.title.backdrop} alt="" />
                    <span className="continue-overlay">
                      <Play size={18} fill="currentColor" />
                      <strong>{p.episode.title.name}</strong>
                      <small>
                        {p.episode.name} · {Math.ceil((p.episode.duration - p.seconds) / 60)}m left
                      </small>
                    </span>
                    <span
                      className="watch-progress"
                      style={{ width: `${(p.seconds / p.episode.duration) * 100}%` }}
                    />
                  </Link>
                ))}
            </div>
          </section>
        )}
        {filtered.length ? (
          <Shelf
            title={filter === 'All stories' ? 'Find your next obsession' : filter}
            subtitle="Big worlds. Unforgettable characters. Just press play."
            items={filtered}
          />
        ) : (
          <Empty title="Nothing here yet">Try another category.</Empty>
        )}
        {collections.data?.map((c) => {
          const items = c.items
            .map((i) => titles.find((t) => t.id === i.titleId))
            .filter(Boolean) as Title[];
          return items.length ? <Shelf key={c.id} title={c.name} items={items} /> : null;
        })}
        {preview && (
          <section className="editorial-banner">
            <img src="/art/forest.png" alt="" />
            <div>
              <span className="eyebrow">WORLDS WORTH GETTING LOST IN</span>
              <h2>
                Extraordinary stories.
                <br />
                Your kind of company.
              </h2>
              <Link className="button glass" href="/login">
                Join your circle <LockKeyhole size={16} />
              </Link>
            </div>
          </section>
        )}
        <div className="endnote">
          <span />
          YOU’RE IN GOOD COMPANY
          <span />
        </div>
      </div>
    </>
  );
}
export function Home({ preview = false }: { preview?: boolean }) {
  return (
    <Shell preview={preview}>
      <HomeContent preview={preview} />
    </Shell>
  );
}
function BrowseContent() {
  const query = useSearchParams();
  const { data, error, loading, reload } = useData<Title[]>('/catalog');
  const [search, setSearch] = useState(query.get('q') || '');
  const [category, setCategory] = useState(query.get('category') || 'ALL');
  const [format, setFormat] = useState('ALL');
  const [language, setLanguage] = useState('ALL');
  const [access, setAccess] = useState('ALL');
  const [sort, setSort] = useState('newest');
  useEffect(() => {
    setSearch(query.get('q') || '');
    setCategory(query.get('category') || 'ALL');
  }, [query]);
  const titles = useMemo(() => {
    const items = (data || []).filter(
      (t) =>
        (category === 'ALL' || t.category === category) &&
        (format === 'ALL' || t.format === format) &&
        (language === 'ALL' || t.languages.includes(language)) &&
        (access === 'ALL' || t.products[0]?.mode === access) &&
        `${t.name} ${t.genres.join(' ')}`.toLowerCase().includes(search.toLowerCase()),
    );
    return sort === 'az' ? items.sort((a, b) => a.name.localeCompare(b.name)) : items;
  }, [data, category, format, language, access, search, sort]);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FOLLOW YOUR CURIOSITY</span>
          <h1>
            A world of stories<span className="accent-dot">.</span>
          </h1>
          <p>Find exactly what you’re in the mood for.</p>
        </div>
        <span className="count-label">{titles.length} titles</span>
      </div>
      <div className="browse-toolbar">
        <div className="search-large">
          <Search size={20} />
          <input
            placeholder="Search titles or genres…"
            aria-label="Search catalog"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select aria-label="Sort titles" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Recently added</option>
          <option value="az">A–Z</option>
        </select>
      </div>
      <div className="filter-bar">
        <SlidersHorizontal size={17} />
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="ALL">All categories</option>
          <option value="ANIME">Anime</option>
          <option value="CARTOON">Cartoons</option>
          <option value="LIVE_ACTION">Live action</option>
        </select>
        <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="ALL">All formats</option>
          <option value="MOVIE">Movies</option>
          <option value="SERIES">Series</option>
        </select>
        <select
          aria-label="Language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="ALL">All languages</option>
          {Array.from(new Set(data?.flatMap((t) => t.languages) || [])).map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select aria-label="Access" value={access} onChange={(e) => setAccess(e.target.value)}>
          <option value="ALL">All access</option>
          <option value="FREE">Free</option>
          <option value="PURCHASE">Purchase</option>
          <option value="RENTAL">Rental</option>
        </select>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : titles.length ? (
        <div className="catalog-grid">
          {titles.map((t, i) => (
            <Card title={t} index={i} key={t.id} />
          ))}
        </div>
      ) : (
        <Empty title="No stories found">Try a different search or filter.</Empty>
      )}
    </div>
  );
}
export function Browse() {
  return (
    <Shell>
      <BrowseContent />
    </Shell>
  );
}
function LibraryContent() {
  const library = useData<Library>('/library');
  const catalog = useData<Title[]>('/catalog');
  const [tab, setTab] = useState('Watchlist');
  const titles =
    tab === 'Watchlist'
      ? catalog.data?.filter((t) => library.data?.saved.includes(t.id))
      : catalog.data?.filter((t) =>
          library.data?.entitlements.some((e) => e.product.title.id === t.id),
        );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR LITTLE CORNER</span>
          <h1>
            My library<span className="accent-dot">.</span>
          </h1>
          <p>The stories you’ve saved. The worlds you’ll return to.</p>
        </div>
        <Bookmark size={32} />
      </div>
      <div className="filter-tabs">
        {['Watchlist', 'Purchased & rented'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={t === tab ? 'selected' : ''}>
            {t}
          </button>
        ))}
      </div>
      {library.loading || catalog.loading ? (
        <Loading />
      ) : library.error || catalog.error ? (
        <ErrorBox message={library.error || catalog.error} />
      ) : titles?.length ? (
        <div className="catalog-grid">
          {titles.map((t) => (
            <div key={t.id}>
              <Card title={t} />
              {tab !== 'Watchlist' &&
                library.data?.entitlements
                  .filter((e) => e.product.title.id === t.id && e.expiresAt)
                  .map((e) => (
                    <p className="rental-note" key={e.id}>
                      Rental ends {new Date(e.expiresAt!).toLocaleString()}
                    </p>
                  ))}
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title={
            tab === 'Watchlist' ? 'Keep your next adventure close' : 'Your collection is waiting'
          }
        >
          {tab === 'Watchlist'
            ? 'Save a title from its detail page and it will appear here.'
            : 'Purchased titles and active rentals will appear here.'}
          <br />
          <Link href="/browse" className="button primary">
            Explore stories
          </Link>
        </Empty>
      )}
    </div>
  );
}
export function LibraryPage() {
  return (
    <Shell>
      <LibraryContent />
    </Shell>
  );
}
