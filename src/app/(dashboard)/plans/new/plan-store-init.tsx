'use client';

import { useEffect, useState } from 'react';
import { usePlanStore } from '@/store/planStore';

export function PlanStoreInit({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    usePlanStore.getState().clearProject();
    setReady(true);
  }, []);
  if (!ready) return null;
  return <>{children}</>;
}
