'use client';

import { useEffect } from 'react';
import { usePlanStore } from '@/store/planStore';

export function PlanStoreInit() {
  useEffect(() => {
    usePlanStore.getState().clearProject();
  }, []);
  return null;
}
