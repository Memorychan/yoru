import { Player } from '@/components/player';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <Player id={id} preview={query.preview === '1'} />;
}
