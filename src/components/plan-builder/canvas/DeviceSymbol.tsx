'use client';

import React, { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Circle, Rect, Line, Text } from 'react-konva';
import { DeviceDefinition } from '@/types/plan-builder';

interface Props {
  def: DeviceDefinition;
  x: number;
  y: number;
  rotation?: number;
  selected?: boolean;
  labelNum?: number;
  concreteMounted?: boolean;
  provisional?: boolean;
  /** When > 1, shows a small "×N" badge — used for stacked data outlets. */
  dataCount?: number;
  size?: number;
  draggable?: boolean;
  onDragEnd?: (x: number, y: number) => void;
  onClick?: () => void;
}

const SYMBOL_SIZE = 42;
const SZ = 14;
const imageCache = new Map<string, HTMLImageElement>();

function useSymbolImage(src: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(
    src ? imageCache.get(src) || null : null
  );

  useEffect(() => {
    if (!src) return;
    if (imageCache.has(src)) {
      setImage(imageCache.get(src)!);
      return;
    }
    const img = new window.Image();
    img.src = src;
    img.onload = () => {
      imageCache.set(src, img);
      setImage(img);
    };
  }, [src]);

  return image;
}

export default function DeviceSymbol({ def, x, y, rotation = 0, selected, labelNum, concreteMounted, provisional, dataCount, size = SZ, draggable, onDragEnd, onClick }: Props) {
  const img = useSymbolImage(def.symbolImage);
  const fill = def.fillColor || '#888888';
  const stroke = def.strokeColor || '#ffffff';
  const s = size;
  const scaledSize = SYMBOL_SIZE * (def.symbolScale || 1) * (size / SZ);

  const renderSymbol = () => {
    if (def.symbolImage && img) {
      return <KonvaImage image={img} x={-scaledSize / 2} y={-scaledSize / 2} width={scaledSize} height={scaledSize} />;
    }
    if (def.symbolImage && !img) return null;
    if (def.symbolType === 'comms-rack') {
      return (
        <>
          <Rect x={-s * 1.2} y={-s * 1.4} width={s * 2.4} height={s * 2.8} fill={fill} stroke={stroke} strokeWidth={2} />
          <Line points={[-s * 1.2, -s * 0.5, s * 1.2, -s * 0.5]} stroke={stroke} strokeWidth={0.8} />
          <Line points={[-s * 1.2, 0, s * 1.2, 0]} stroke={stroke} strokeWidth={0.8} />
          <Line points={[-s * 1.2, s * 0.5, s * 1.2, s * 0.5]} stroke={stroke} strokeWidth={0.8} />
          <Rect x={-s * 0.8} y={-s * 1.1} width={s * 1.6} height={s * 0.4} fill={stroke} opacity={0.6} />
          <Text text="RACK" fontSize={s * 0.55} fill={stroke} align="center" x={-s * 1.2} y={s * 0.9} width={s * 2.4} />
        </>
      );
    }
    return <Circle radius={s} fill={fill} stroke={stroke} strokeWidth={1.5} />;
  };

  return (
    <Group x={x} y={y} rotation={rotation} draggable={draggable} onClick={onClick} onTap={onClick}
      onDragEnd={onDragEnd ? (e) => onDragEnd(e.target.x(), e.target.y()) : undefined}>
      {renderSymbol()}
      {selected && (
        <Rect x={-s * 1.8} y={-s * 1.8} width={s * 3.6} height={s * 3.6} stroke="#00ffff" strokeWidth={1.5} dash={[4, 4]} fill="transparent" listening={false} />
      )}
      {labelNum !== undefined && (() => {
        // Multi-drop data outlets display a range ("5-6", "12-15") instead
        // of the single start number, so the electrician knows the
        // marker covers multiple labelled cables.
        const isRange = dataCount !== undefined && dataCount > 1;
        const labelText = isRange
          ? `${labelNum}-${labelNum + dataCount - 1}`
          : String(labelNum);
        // Pill widens with text length so 3+ chars don't get clipped.
        const pillWidth = Math.max(s * 1.5, s * (0.5 + 0.45 * labelText.length));
        return (
          <Group x={0} y={0} rotation={-rotation}>
            <Rect
              x={-pillWidth / 2} y={s * 1.6 - s * 0.75}
              width={pillWidth} height={s * 1.5}
              cornerRadius={s * 0.75}
              fill="#ffffff" stroke="#000000" strokeWidth={1.2}
              listening={false}
            />
            <Text text={labelText} fontSize={s * 0.8} fill="#000000" fontStyle="bold" align="center" verticalAlign="middle"
              x={-pillWidth / 2} y={s * 1.6 - s * 0.4} width={pillWidth} height={s * 0.8} listening={false} />
          </Group>
        );
      })()}
      {concreteMounted && (
        <Group x={0} y={0} rotation={-rotation}>
          <Circle x={s * 1.4} y={s * 1.4} radius={s * 0.6} fill="#3399ff" stroke="#ffffff" strokeWidth={0.8} listening={false} />
          <Text text="C" fontSize={s * 0.7} fill="#ffffff" fontStyle="bold" align="center" verticalAlign="middle"
            x={s * 1.4 - s * 0.5} y={s * 1.4 - s * 0.35} width={s} height={s * 0.7} listening={false} />
        </Group>
      )}
      {provisional && (
        <Group x={0} y={0} rotation={-rotation}>
          <Circle x={s * -1.4} y={s * 1.4} radius={s * 0.6} fill="#f59e0b" stroke="#ffffff" strokeWidth={0.8} listening={false} />
          <Text text="P" fontSize={s * 0.7} fill="#ffffff" fontStyle="bold" align="center" verticalAlign="middle"
            x={s * -1.4 - s * 0.5} y={s * 1.4 - s * 0.35} width={s} height={s * 0.7} listening={false} />
        </Group>
      )}
      {dataCount !== undefined && dataCount > 1 && (
        // Top-right ×N badge — small high-contrast pill so the electrician
        // can see at a glance how many drops to terminate at this marker.
        <Group x={0} y={0} rotation={-rotation} listening={false}>
          <Rect
            x={s * 1.0}
            y={-s * 1.8}
            width={s * (1.2 + 0.35 * String(dataCount).length)}
            height={s * 0.95}
            cornerRadius={s * 0.45}
            fill="#0066cc"
            stroke="#ffffff"
            strokeWidth={1}
          />
          <Text
            text={`×${dataCount}`}
            fontSize={s * 0.75}
            fontStyle="bold"
            fill="#ffffff"
            align="center"
            verticalAlign="middle"
            x={s * 1.0}
            y={-s * 1.8}
            width={s * (1.2 + 0.35 * String(dataCount).length)}
            height={s * 0.95}
          />
        </Group>
      )}
    </Group>
  );
}
