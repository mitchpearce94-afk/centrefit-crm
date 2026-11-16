import { PlacedDevice } from '@/types/plan-builder';
import { getDeviceById } from '@/lib/plan-builder/devices';

/**
 * Order of one speaker zone's cable run on one floor. Shared by the store
 * (numbering), CableLines (editor) and the PDF export so all three agree.
 *
 * Default = automatic: volume controls first, then speakers, each as a
 * nearest-neighbour daisy chain from the start point (the comms rack, or
 * the link from the previous floor).
 *
 * Manual override (Mitchell 16 Nov 2026): any device with `runOrder` set is
 * pinned to that position (1 = first after the rack). The unpinned ones keep
 * the automatic chain and fill the gaps in between — so you can push the
 * volume control to after the main-gym speakers and put the pilates
 * speaker last, without having to number every other speaker.
 */
export function nearestChain(list: PlacedDevice[], startX: number, startY: number): PlacedDevice[] {
  const remaining = [...list];
  const chain: PlacedDevice[] = [];
  let cx = startX, cy = startY;
  while (remaining.length > 0) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dx = remaining[i].x - cx, dy = remaining[i].y - cy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    const n = remaining.splice(bi, 1)[0];
    chain.push(n); cx = n.x; cy = n.y;
  }
  return chain;
}

export function buildSpeakerChain(zoneDevices: PlacedDevice[], startX: number, startY: number): PlacedDevice[] {
  const pinned = zoneDevices.filter(d => typeof d.runOrder === 'number' && d.runOrder > 0)
    .sort((a, b) => (a.runOrder! - b.runOrder!) || (a.x - b.x));
  const free = zoneDevices.filter(d => !pinned.includes(d));
  const vcs = free.filter(d => getDeviceById(d.deviceId)?.isVolumeControl);
  const spks = free.filter(d => !getDeviceById(d.deviceId)?.isVolumeControl);
  const vcChain = nearestChain(vcs, startX, startY);
  const lastVc = vcChain[vcChain.length - 1];
  const auto = [...vcChain, ...nearestChain(spks, lastVc?.x ?? startX, lastVc?.y ?? startY)];
  if (pinned.length === 0) return auto;
  // Merge: walk positions 1..N, placing a pinned device when its number comes up, else the next automatic one.
  const out: PlacedDevice[] = [];
  const total = zoneDevices.length;
  let ai = 0, pi = 0;
  for (let pos = 1; pos <= total; pos++) {
    if (pi < pinned.length && (pinned[pi].runOrder! <= pos || ai >= auto.length)) out.push(pinned[pi++]);
    else if (ai < auto.length) out.push(auto[ai++]);
    else if (pi < pinned.length) out.push(pinned[pi++]);
  }
  return out;
}
