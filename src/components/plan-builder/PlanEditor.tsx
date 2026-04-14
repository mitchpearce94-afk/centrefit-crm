'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import SymbolPalette from '@/components/plan-builder/sidebar/SymbolPalette';
import PropertiesPanel from '@/components/plan-builder/sidebar/PropertiesPanel';
import Toolbar, { type JobOption } from '@/components/plan-builder/toolbar/Toolbar';
import TitleBlock from '@/components/plan-builder/TitleBlock';
import { usePlanStore } from '@/store/planStore';

const PlanCanvas = dynamic(() => import('@/components/plan-builder/canvas/PlanCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full text-gray-500">
      Loading canvas...
    </div>
  ),
});

export default function PlanEditor({ jobs = [] }: { jobs?: JobOption[] }) {
  const isDirty = usePlanStore(s => s.isDirty);

  // Browser tab close / refresh
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Intercept in-app link clicks (Next.js client-side navigation)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!usePlanStore.getState().isDirty) return;
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      // Only intercept same-origin navigation away from the plan builder
      if (anchor.origin !== window.location.origin) return;
      if (href.includes('/plans/new')) return; // staying on same page
      e.preventDefault();
      e.stopPropagation();
      if (window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
        usePlanStore.getState().markClean();
        window.location.href = href;
      }
    };
    // Browser back/forward button
    const handlePopState = () => {
      if (!usePlanStore.getState().isDirty) return;
      if (!window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.addEventListener('click', handleClick, true);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  return (
    <div className="flex flex-col bg-gray-950 text-white overflow-hidden -m-4 md:-m-6" style={{ height: 'calc(100vh - 0px)' }}>
      {/* Toolbar */}
      <div className="flex-shrink-0">
        <Toolbar jobs={jobs} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Symbol Palette */}
        <div className="w-52 flex-shrink-0 bg-gray-900 border-r border-gray-700 overflow-hidden flex flex-col">
          <SymbolPalette />
        </div>

        {/* Canvas area */}
        <div className="flex-1 relative canvas-container bg-gray-950 overflow-hidden">
          <PlanCanvas />
        </div>

        {/* Right sidebar - Properties */}
        <div className="w-52 flex-shrink-0 bg-gray-900 border-l border-gray-700 overflow-hidden">
          <PropertiesPanel />
        </div>
      </div>

      {/* Title block */}
      <div className="flex-shrink-0">
        <TitleBlock />
      </div>
    </div>
  );
}
