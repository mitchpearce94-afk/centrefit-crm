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

export default function DeviceSymbol({ def, x, y, rotation = 0, selected, labelNum, size = SZ, draggable, onDragEnd, onClick }: Props) {
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
      {labelNum !== undefined && (
        <Group x={0} y={0} rotation={-rotation}>
          <Circle x={0} y={s * 1.6} radius={s * 0.75} fill="#ffffff" stroke="#000000" strokeWidth={1.2} listening={false} />
          <Text text={String(labelNum)} fontSize={s * 0.8} fill="#000000" fontStyle="bold" align="center" verticalAlign="middle"
            x={-s} y={s * 1.6 - s * 0.4} width={s * 2} height={s * 0.8} listening={false} />
        </Group>
      )}
    </Group>
  );
}
