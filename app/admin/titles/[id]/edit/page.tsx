import { TitleEditor } from '@/components/admin';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TitleEditor id={id} />;
}
