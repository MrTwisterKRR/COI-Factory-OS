import rawLayouts from './raw/building_layouts.json';
import type { LogisticsSummary } from '../types/coi';

export interface RawPortDef {
  n: string; // port name (A, B, X, Y, ...)
  k: 'flat' | 'loose' | 'fluid' | 'molten';
  in: number; // 1 = input, 0 = output
  rx: number;
  ry: number;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
}

export interface RawBuildingLayout {
  w: number;
  h: number;
  ox?: number;
  oy?: number;
  ports: RawPortDef[];
}

export interface WorldPort {
  name: string;
  kind: Exclude<LogisticsSummary['kind'], 'virtual'>;
  isInput: boolean;
  /** Perimeter tile inside the building */
  tileX: number;
  tileY: number;
  tileZ: number;
  /** First external tile directly adjacent to this port where transport begins/ends */
  connX: number;
  connY: number;
  connZ: number;
  /** Outward unit direction pointing from the building out through the port */
  dirX: number;
  dirY: number;
}

export interface OccupiedBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const BUILDING_LAYOUTS = rawLayouts as Record<string, RawBuildingLayout>;

const FALLBACK_LAYOUT: RawBuildingLayout = {
  w: 5,
  h: 5,
  ports: [
    { n: 'A', k: 'flat', in: 1, rx: 0, ry: 3, cx: -1, cy: 3, dx: -1, dy: 0 },
    { n: 'B', k: 'loose', in: 1, rx: 0, ry: 2, cx: -1, cy: 2, dx: -1, dy: 0 },
    { n: 'C', k: 'fluid', in: 1, rx: 0, ry: 1, cx: -1, cy: 1, dx: -1, dy: 0 },
    { n: 'X', k: 'flat', in: 0, rx: 4, ry: 3, cx: 5, cy: 3, dx: 1, dy: 0 },
    { n: 'Y', k: 'loose', in: 0, rx: 4, ry: 2, cx: 5, cy: 2, dx: 1, dy: 0 },
    { n: 'Z', k: 'fluid', in: 0, rx: 4, ry: 1, cx: 5, cy: 1, dx: 1, dy: 0 },
  ],
};

export function getRawBuildingLayout(protoId: string): RawBuildingLayout {
  return BUILDING_LAYOUTS[protoId] ?? FALLBACK_LAYOUT;
}

export function normalizeRotIndex(rotIndex = 0): 0 | 1 | 2 | 3 {
  const m = ((Math.round(rotIndex) % 4) + 4) % 4;
  return m as 0 | 1 | 2 | 3;
}

/**
 * Rotates a relative vector `(dx, dy)` in COI's Y-up tile space according to `Mafi.Rotation90`:
 * Deg0 = (dx, dy), Deg90 = (-dy, dx), Deg180 = (-dx, -dy), Deg270 = (dy, -dx).
 */
export function rotateRelVector(
  dx: number,
  dy: number,
  rotIndex: number,
  reflected = false,
): [number, number] {
  const y0 = reflected ? -dy : dy;
  switch (normalizeRotIndex(rotIndex)) {
    case 0:
      return [dx, y0];
    case 1:
      return [-y0, dx];
    case 2:
      return [-dx, -y0];
    case 3:
      return [y0, -dx];
  }
}

function rotateCoordInBox(
  rx: number,
  ry: number,
  w: number,
  h: number,
  rotIndex: number,
  reflected = false,
): [number, number] {
  const ryR = reflected ? h - 1 - ry : ry;
  switch (normalizeRotIndex(rotIndex)) {
    case 0:
      return [rx, ryR];
    case 1:
      return [h - 1 - ryR, rx];
    case 2:
      return [w - 1 - rx, h - 1 - ryR];
    case 3:
      return [ryR, w - 1 - rx];
  }
}

export function getBuildingCenterOffset(layout: RawBuildingLayout): {
  cx: number;
  cy: number;
} {
  return {
    cx:
      layout.ox !== undefined ? Math.floor(layout.ox) : Math.floor(layout.w / 2),
    cy:
      layout.oy !== undefined ? Math.floor(layout.oy) : Math.floor(layout.h / 2),
  };
}

/**
 * Returns the inclusive tile bounding box `[minX..maxX] × [minY..maxY]`
 * occupied by a building placed at Transform center `(tx, ty)`.
 * Matches `Mafi.Core.Entities.Static.Layout.EntityLayout.GetCoreOffset / Transform`.
 */
export function getBuildingOccupiedBox(
  protoId: string,
  tx: number,
  ty: number,
  rotIndex = 0,
  reflected = false,
): OccupiedBox {
  const layout = getRawBuildingLayout(protoId);
  const rot = normalizeRotIndex(rotIndex);
  if (layout.ox !== undefined || layout.oy !== undefined) {
    const { cx, cy } = getBuildingCenterOffset(layout);
    const corners: [number, number][] = [
      [0 - cx, 0 - cy],
      [layout.w - 1 - cx, 0 - cy],
      [0 - cx, layout.h - 1 - cy],
      [layout.w - 1 - cx, layout.h - 1 - cy],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [dx, dy] of corners) {
      const [rx, ry] = rotateRelVector(dx, dy, rot, reflected);
      const wx = tx + rx;
      const wy = ty + ry;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }

  const width = rot % 2 === 1 ? layout.h : layout.w;
  const height = rot % 2 === 1 ? layout.w : layout.h;
  const minX = tx - Math.floor(width / 2);
  const minY = ty - Math.floor(height / 2);
  return {
    minX,
    minY,
    maxX: minX + width - 1,
    maxY: minY + height - 1,
    width,
    height,
  };
}

/**
 * Given a desired bottom-left corner `(minX, minY)` on the tile grid,
 * computes the exact `Transform` center `(tx, ty)` to write into the blueprint.
 */
export function minCornerToTransformCenter(
  protoId: string,
  minX: number,
  minY: number,
  rotIndex = 0,
  reflected = false,
): { tx: number; ty: number } {
  const boxZero = getBuildingOccupiedBox(protoId, 0, 0, rotIndex, reflected);
  return {
    tx: minX - boxZero.minX,
    ty: minY - boxZero.minY,
  };
}

export function getBuildingWorldPorts(
  protoId: string,
  tx: number,
  ty: number,
  rotIndex = 0,
  reflected = false,
  tz = 0,
): WorldPort[] {
  const layout = getRawBuildingLayout(protoId);
  const rot = normalizeRotIndex(rotIndex);
  const box = getBuildingOccupiedBox(protoId, tx, ty, rot, reflected);
  const liftMatch = protoId.startsWith('LiftIoPortShape_')
    ? protoId.match(/_(\d+)$/)
    : null;
  const liftZ = liftMatch ? Number(liftMatch[1]) : 0;

  if (layout.ox !== undefined || layout.oy !== undefined) {
    const { cx, cy } = getBuildingCenterOffset(layout);
    return layout.ports.map((p) => {
      const [rtx, rty] = rotateRelVector(p.rx - cx, p.ry - cy, rot, reflected);
      const [rcx, rcy] = rotateRelVector(p.cx - cx, p.cy - cy, rot, reflected);
      const [rdx, rdy] = rotateRelVector(p.dx, p.dy, rot, reflected);
      const portZ = tz + (liftZ > 0 && p.n === 'X' ? liftZ : 0);
      return {
        name: p.n,
        kind: p.k,
        isInput: p.in === 1,
        tileX: tx + rtx,
        tileY: ty + rty,
        tileZ: portZ,
        connX: tx + rcx,
        connY: ty + rcy,
        connZ: portZ,
        dirX: rdx,
        dirY: rdy,
      };
    });
  }

  return layout.ports.map((p) => {
    const [ltX, ltY] = rotateCoordInBox(
      p.rx,
      p.ry,
      layout.w,
      layout.h,
      rot,
      reflected,
    );
    const [lcX, lcY] = rotateCoordInBox(
      p.cx,
      p.cy,
      layout.w,
      layout.h,
      rot,
      reflected,
    );
    const [rdx, rdy] = rotateRelVector(p.dx, p.dy, rot, reflected);
    const portZ = tz + (liftZ > 0 && p.n === 'X' ? liftZ : 0);
    return {
      name: p.n,
      kind: p.k,
      isInput: p.in === 1,
      tileX: box.minX + ltX,
      tileY: box.minY + ltY,
      tileZ: portZ,
      connX: box.minX + lcX,
      connY: box.minY + lcY,
      connZ: portZ,
      dirX: rdx,
      dirY: rdy,
    };
  });
}
