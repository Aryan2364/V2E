'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/context';
import { useLayout } from '@/lib/layout';
import { signedInHome } from '@/lib/phone-routes';

export default function HomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { layout } = useLayout();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
    } else {
      // Desktop: unchanged. Phone: My work, the phone's home (lib/phone-routes.ts).
      router.replace(signedInHome(user, layout));
    }
  }, [user, isLoading, router, layout]);

  return (
    <div className="min-h-screen bg-surface-sunken flex items-center justify-center">
      <div className="text-text-secondary text-sm">Loading V2E...</div>
    </div>
  );
}
