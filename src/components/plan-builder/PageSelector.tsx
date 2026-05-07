'use client';

import React from 'react';
import { PdfPageInfo } from '@/lib/plan-builder/pdfUtils';

interface PageSelectorProps {
  pages: PdfPageInfo[];
  onSelect: (pageNumber: number) => void;
  onCancel: () => void;
}

export default function PageSelector({ pages, onSelect, onCancel }: PageSelectorProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/90">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-3xl w-full mx-4 max-h-[85dvh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">
            Select a page from the PDF
            <span className="ml-2 text-gray-500 font-normal">({pages.length} pages)</span>
          </h2>
          <button onClick={onCancel} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors">Cancel</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {pages.map((page) => (
              <button key={page.pageNumber} onClick={() => onSelect(page.pageNumber)}
                className="group flex flex-col items-center gap-1.5 p-2 rounded-lg border border-gray-700 bg-gray-800 hover:border-blue-500 hover:bg-gray-750 transition-colors cursor-pointer">
                <div className="relative w-full overflow-hidden rounded bg-white">
                  <img src={page.thumbnail} alt={`Page ${page.pageNumber}`} className="w-full h-auto" />
                  <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/10 transition-colors" />
                </div>
                <span className="text-xs text-gray-400 group-hover:text-blue-400 transition-colors">Page {page.pageNumber}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
