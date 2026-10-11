import { UploadDetail } from '@/components/upload-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <UploadDetail id={(await params).id} />;
}
