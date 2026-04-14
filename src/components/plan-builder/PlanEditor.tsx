'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pendingPopState, setPendingPopState] = useState(false);

  // Browser tab close / refresh (can only use native dialog here)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Intercept in-app link clicks and back/forward
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!usePlanStore.getState().isDirty) return;
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      if (anchor.origin !== window.location.origin) return;
      if (href === window.location.pathname) return; // same page
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    };
    const handlePopState = () => {
      if (!usePlanStore.getState().isDirty) return;
      window.history.pushState(null, '', window.location.href);
      setPendingPopState(true);
    };
    window.addEventListener('click', handleClick, true);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const handleLeave = useCallback(() => {
    usePlanStore.getState().markClean();
    if (pendingHref) {
      const href = pendingHref;
      setPendingHref(null);
      window.location.href = href;
    } else if (pendingPopState) {
      setPendingPopState(false);
      window.history.back();
    }
  }, [pendingHref, pendingPopState]);

  const handleStay = useCallback(() => {
    setPendingHref(null);
    setPendingPopState(false);
  }, []);

  const showModal = pendingHref !== null || pendingPopState;

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

      {/* Unsaved changes modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]">
          <div className="bg-gray-800 rounded-lg border border-gray-600 w-[420px] shadow-2xl">
            <div className="px-6 py-5">
              <h3 className="text-white font-bold text-base mb-2">Unsaved Changes</h3>
              <p className="text-gray-400 text-sm">You have unsaved changes to this plan. If you leave now, your changes will be lost.</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-end gap-3">
              <button
                onClick={handleStay}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
              >
                Stay on Page
              </button>
              <button
                onClick={handleLeave}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded transition-colors"
              >
                Leave Without Saving
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
