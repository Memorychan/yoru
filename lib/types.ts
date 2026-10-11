export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}
export interface Product {
  id: string;
  mode: 'FREE' | 'PURCHASE' | 'RENTAL';
  pricePaise: number;
  rentalHours: number;
}
export interface Episode {
  id: string;
  name: string;
  season: number;
  number: number;
  duration: number;
  introStart: number;
  introEnd: number;
  outroStart: number;
  outroEnd: number;
  asset?: { id: string; bytes?: string; storageId?: string } | null;
  uploads?: Upload[];
}
export interface Title {
  id: string;
  name: string;
  slug: string;
  synopsis: string;
  format: 'MOVIE' | 'SERIES';
  category: 'ANIME' | 'CARTOON' | 'LIVE_ACTION';
  genres: string[];
  languages: string[];
  year: number;
  ageRating: string;
  poster: string;
  backdrop: string;
  status: string;
  featured: boolean;
  showcase: boolean;
  products: Product[];
  episodes: Episode[];
  canWatch?: boolean;
  rightsNote?: string;
  availableUntil?: string | null;
}
export interface Upload {
  createdAt: string;
  id: string;
  state: string;
  progress: number;
  filename: string;
  totalBytes: string;
  receivedBytes: string;
  error: string | null;
  chunkHashes: string[];
  stageDetail: string;
  stageProgress: number;
  stageBytes: string;
  stageTotalBytes: string;
  speedBps: number;
  heartbeatAt: string | null;
  updatedAt: string;
  storage?: { name: string; bucket: string };
  episode?: Episode & { title: { id?: string; name: string } };
}
export interface Storage {
  id: string;
  name: string;
  bucket: string;
  enabled: boolean;
  health: string;
  _count: { assets: number };
}
export interface Collection {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  items: { titleId: string; position: number }[];
}
export interface Order {
  id: string;
  amount: number;
  status: string;
  mode: string;
  createdAt: string;
  product: { title: { name: string } };
  user?: { name: string; email: string };
}
export interface Library {
  saved: string[];
  progress: { seconds: number; episode: Episode & { title: Title } }[];
  entitlements: { id: string; expiresAt: string | null; product: Product & { title: Title } }[];
  orders: Order[];
}
