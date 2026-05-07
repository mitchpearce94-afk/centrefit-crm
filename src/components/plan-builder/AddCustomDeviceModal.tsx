'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePlanStore } from '@/store/planStore';
import { DeviceCategory, CableType, CustomDevice } from '@/types/plan-builder';
import { CATEGORY_LABELS } from '@/lib/plan-builder/devices';
import { createClient } from '@/lib/supabase/client';

interface Props {
  onClose: () => void;
}

const CATEGORY_OPTIONS: DeviceCategory[] = ['cameras', 'security', 'audio', 'data', 'av'];

const CATEGORY_CABLE_MAP: Record<DeviceCategory, CableType> = {
  cameras: 'cat6',
  security: 'sixcore',
  audio: 'speaker',
  data: 'cat6',
  av: 'cat6',
};

interface ProductResult {
  id: string;
  name: string;
  sku: string;
}

export default function AddCustomDeviceModal({ onClose }: Props) {
  const { addCustomDevice } = usePlanStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<DeviceCategory>('cameras');
  const [needsCableRun, setNeedsCableRun] = useState(true);
  const [symbolImage, setSymbolImage] = useState<string | null>(null);
  const [symbolPreview, setSymbolPreview] = useState<string | null>(null);

  // Product search
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<ProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkedProduct, setLinkedProduct] = useState<{ id: string; name: string } | null>(null);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (productSearch.length < 2) { setProductResults([]); return; }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('quote_products')
          .select('id, name, sku')
          .eq('is_active', true)
          .ilike('name', `%${productSearch}%`)
          .limit(10);
        setProductResults(data || []);
      } catch { setProductResults([]); }
      setSearching(false);
    }, 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [productSearch]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please upload an image file (PNG, JPG, etc.)'); return; }
    if (file.size > 512 * 1024) { alert('Image must be under 512KB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setSymbolImage(dataUrl);
      setSymbolPreview(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmit = () => {
    if (!name.trim()) { alert('Device name is required'); return; }
    if (!symbolImage) { alert('Please upload a symbol image'); return; }

    const cableType: CableType = needsCableRun ? CATEGORY_CABLE_MAP[category] : 'none';
    const device: CustomDevice = {
      id: `custom-${crypto.randomUUID()}`,
      name: name.trim(),
      category,
      cableType,
      symbolImage,
      needsCableRun,
      linkedProductId: linkedProduct?.id,
      linkedProductName: linkedProduct?.name,
    };

    addCustomDevice(device);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg p-5 w-[420px] border border-gray-600 max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-bold text-sm mb-4">Add Custom Device</h3>

        {/* Device Name */}
        <div className="mb-3">
          <label className="block text-gray-400 text-xs mb-1">Device Name *</label>
          <input
            type="text"
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            placeholder="e.g. Turnstile Controller"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* Category */}
        <div className="mb-3">
          <label className="block text-gray-400 text-xs mb-1">Category</label>
          <select
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            value={category}
            onChange={e => setCategory(e.target.value as DeviceCategory)}
          >
            {CATEGORY_OPTIONS.map(cat => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
        </div>

        {/* Symbol Image Upload */}
        <div className="mb-3">
          <label className="block text-gray-400 text-xs mb-1">Symbol Image * (PNG, max 512KB)</label>
          <div className="flex items-center gap-3">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            <button
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {symbolPreview ? 'Change Image' : 'Upload Image'}
            </button>
            {symbolPreview && (
              <div className="w-10 h-10 bg-gray-900 border border-gray-600 rounded flex items-center justify-center">
                <img src={symbolPreview} alt="Symbol preview" className="w-8 h-8 object-contain" />
              </div>
            )}
          </div>
        </div>

        {/* Needs Cable Run */}
        <div className="mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={needsCableRun}
              onChange={e => setNeedsCableRun(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />
            <span className="text-gray-300 text-sm">Needs cable run</span>
            <span className="text-gray-500 text-xs">
              ({needsCableRun ? CATEGORY_CABLE_MAP[category].toUpperCase() : 'None'})
            </span>
          </label>
        </div>

        {/* Product Link */}
        <div className="mb-4">
          <label className="block text-gray-400 text-xs mb-1">Link to Product (optional, for BOM)</label>
          {linkedProduct ? (
            <div className="flex items-center gap-2 bg-gray-900 border border-gray-600 rounded px-3 py-2">
              <span className="text-green-400 text-sm flex-1 truncate">{linkedProduct.name}</span>
              <button
                className="text-gray-500 hover:text-red-400 text-xs"
                onClick={() => { setLinkedProduct(null); setProductSearch(''); }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="Search products..."
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
              />
              {searching && <span className="absolute right-3 top-2.5 text-gray-500 text-xs">...</span>}
              {productResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-gray-900 border border-gray-600 rounded shadow-lg max-h-40 overflow-y-auto z-10">
                  {productResults.map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                      onClick={() => { setLinkedProduct({ id: p.id, name: p.name }); setProductSearch(''); setProductResults([]); }}
                    >
                      <span>{p.name}</span>
                      {p.sku && <span className="text-gray-500 ml-2 text-xs">{p.sku}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded font-medium"
            onClick={handleSubmit}
          >
            Add Device
          </button>
        </div>
      </div>
    </div>
  );
}
