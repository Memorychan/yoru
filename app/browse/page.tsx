import { Suspense } from 'react';
import { Browse } from '@/components/catalog';
export default function Page() {
  return (
    <Suspense>
      <Browse />
    </Suspense>
  );
}
