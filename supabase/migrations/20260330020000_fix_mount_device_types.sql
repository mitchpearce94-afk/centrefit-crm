-- ============================================================================
-- Fix: Camera mounts/brackets should NOT have device_type set.
-- They are ancillary products added by dependency rules, not the primary
-- product for camera_white / camera_black device types.
-- This was causing the BOM engine to map "white camera" → "wall mount"
-- instead of the actual camera.
-- ============================================================================

-- White camera mounts — clear device_type, keep is_default false
UPDATE public.quote_products SET device_type = NULL, is_default = false
WHERE sku IN ('PFA-139', 'PFB204W');

-- Black camera mounts/brackets — clear device_type
UPDATE public.quote_products SET device_type = NULL
WHERE sku IN ('DH-AC-PFA109', 'PFB220C', 'DH-PFA139-B');

-- Black camera junction box — clear device_type
UPDATE public.quote_products SET device_type = NULL
WHERE sku = 'DCS-F480JB-BLK';
