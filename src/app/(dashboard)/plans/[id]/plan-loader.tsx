'use client';

import { useEffect, useState } from 'react';
import { usePlanStore } from '@/store/planStore';

export function PlanLoader({ planId, cfpUrl, children }: { planId: string; cfpUrl: string; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const store = usePlanStore.getState();
    // If the store already has this plan loaded, skip re-fetching
    if (store.planFileId === planId && store.devices.length > 0) {
      setReady(true);
      return;
    }

    // Fetch the .cfp and load it
    fetch(cfpUrl + '?t=' + Date.now())
      .then(res => res.text())
      .then(text => {
        usePlanStore.getState().loadProject(text);
        usePlanStore.setState({ planFileId: planId });
        setReady(true);
      })
      .catch(err => {
        console.error('Failed to load plan:', err);
        setReady(true); // show editor anyway
      });
  }, [planId, cfpUrl]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-400">
        Loading plan...
      </div>
    );
  }

  return <>{children}</>;
}
