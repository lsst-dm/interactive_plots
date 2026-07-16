// Port of lsst.skymap.RingsSkyMap to TypeScript
// Only the geometry needed to compute tract centers and inner/outer bounding box corners.
// Original: GPLv3, LSST Data Management System

export interface RingsSkyMapConfig {
  numRings: number;
  raStart?: number; // degrees, default 0.0
  version?: number; // 0 or 1, default 1
  tractOverlap?: number; // degrees, default 1.0
}

export interface TractCorners {
  tract_id: number;
  ra: number; // center RA in degrees
  dec: number; // center Dec in degrees
  inner: [number, number][]; // 4 corners [ra, dec] in degrees
  outer: [number, number][]; // 4 corners [ra, dec] in degrees (inner + overlap)
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Wrap angle to [-pi, pi) to match lsst.geom.Angle.wrap() */
function wrapAngle(angle: number): number {
  let a = angle - 2 * Math.PI * Math.floor(angle / (2 * Math.PI));
  if (a >= Math.PI) a -= 2 * Math.PI;
  return a;
}

export class RingsSkyMap {
  private readonly ringSize: number; // radians
  private readonly ringNums: number[]; // tracts per ring
  private readonly numTracts: number;
  private readonly raStart: number; // radians
  private readonly version: number;
  private readonly numRings: number;
  private readonly tractOverlap: number; // radians

  constructor(config: RingsSkyMapConfig) {
    this.numRings = config.numRings;
    this.version = config.version ?? 1;
    this.raStart = (config.raStart ?? 0) * DEG_TO_RAD;
    this.tractOverlap = (config.tractOverlap ?? 1.0) * DEG_TO_RAD;
    this.ringSize = Math.PI / (this.numRings + 1);

    this.ringNums = [];
    for (let i = 0; i < this.numRings; i++) {
      const startDec = this.ringSize * (i + 0.5) - 0.5 * Math.PI;
      const stopDec = startDec + this.ringSize;
      const dec = Math.min(Math.abs(startDec), Math.abs(stopDec));
      this.ringNums.push(Math.floor((2 * Math.PI * Math.cos(dec)) / this.ringSize) + 1);
    }

    this.numTracts = this.ringNums.reduce((a, b) => a + b, 0) + 2;
  }

  getNumTracts(): number {
    return this.numTracts;
  }

  /** Convert tract index to [ringNum, tractNum].
   *  ringNum is -1 for south polar cap, numRings for north polar cap.
   *  tractNum is the position within the ring (0-based). */
  getRingIndices(index: number): [number, number] {
    if (index === 0) return [-1, 0];
    if (index === this.numTracts - 1) return [this.numRings, 0];
    if (index < 0 || index >= this.numTracts) {
      throw new RangeError(`Tract index ${index} out of range [0, ${this.numTracts - 1}]`);
    }

    let ring = 0;
    let tractNum = index - 1;

    if (this.version === 0) {
      while (ring < this.numRings && tractNum > this.ringNums[ring]) {
        tractNum -= this.ringNums[ring];
        ring++;
      }
    } else {
      while (ring < this.numRings && tractNum >= this.ringNums[ring]) {
        tractNum -= this.ringNums[ring];
        ring++;
      }
    }

    return [ring, tractNum];
  }

  /** Get the RA/Dec range for the inner region of a tract (all in radians). */
  getRaDecRange(index: number): { raMin: number; raMax: number; decMin: number; decMax: number } {
    const [ringNum, tractNum] = this.getRingIndices(index);

    if (ringNum === -1) {
      return {
        raMin: 0,
        raMax: 2 * Math.PI,
        decMin: -Math.PI / 2,
        decMax: -Math.PI / 2 + (ringNum + 1.5) * this.ringSize,
      };
    }

    if (ringNum === this.numRings) {
      return {
        raMin: 0,
        raMax: 2 * Math.PI,
        decMin: -Math.PI / 2 + (ringNum + 0.5) * this.ringSize,
        decMax: Math.PI / 2,
      };
    }

    const decMin = -Math.PI / 2 + (ringNum + 0.5) * this.ringSize;
    const decMax = -Math.PI / 2 + (ringNum + 1.5) * this.ringSize;

    const deltaStart = ((tractNum - 0.5) * 2 * Math.PI) / this.ringNums[ringNum];
    const deltaStop = ((tractNum + 0.5) * 2 * Math.PI) / this.ringNums[ringNum];

    const raMin = wrapAngle(this.raStart + deltaStart);
    const raMax = wrapAngle(this.raStart + deltaStop);

    return { raMin, raMax, decMin, decMax };
  }

  /** Get the center RA/Dec of a tract (radians). */
  getTractCenterRad(index: number): { ra: number; dec: number } {
    const [ringNum, tractNum] = this.getRingIndices(index);

    if (ringNum === -1) return { ra: 0, dec: -Math.PI / 2 };
    if (ringNum === this.numRings) return { ra: 0, dec: Math.PI / 2 };

    const dec = this.ringSize * (ringNum + 1) - Math.PI / 2;
    const ra = wrapAngle((2 * Math.PI * tractNum) / this.ringNums[ringNum] + this.raStart);

    return { ra, dec };
  }

  /** Get full tract info with center and corners in degrees. */
  getTractInfo(index: number): TractCorners {
    const center = this.getTractCenterRad(index);
    const range = this.getRaDecRange(index);

    const raMinDeg = range.raMin * RAD_TO_DEG;
    const raMaxDeg = range.raMax * RAD_TO_DEG;
    const decMinDeg = range.decMin * RAD_TO_DEG;
    const decMaxDeg = range.decMax * RAD_TO_DEG;

    const inner: [number, number][] = [
      [raMinDeg, decMinDeg],
      [raMaxDeg, decMinDeg],
      [raMaxDeg, decMaxDeg],
      [raMinDeg, decMaxDeg],
    ];

    // Outer box: expand by tractOverlap in dec, and proportionally in RA
    const overlapDeg = this.tractOverlap * RAD_TO_DEG;
    const outerDecMin = decMinDeg - overlapDeg;
    const outerDecMax = decMaxDeg + overlapDeg;

    let outerRaMinDeg: number;
    let outerRaMaxDeg: number;
    const [ringNum] = this.getRingIndices(index);
    if (ringNum === -1 || ringNum === this.numRings) {
      outerRaMinDeg = 0;
      outerRaMaxDeg = 360;
    } else {
      // Expand RA by overlap / cos(dec_center)
      const cosDec = Math.cos(center.dec);
      const raOverlap = cosDec > 1e-6 ? overlapDeg / cosDec : 360;
      outerRaMinDeg = raMinDeg - raOverlap;
      outerRaMaxDeg = raMaxDeg + raOverlap;
    }

    const outer: [number, number][] = [
      [outerRaMinDeg, outerDecMin],
      [outerRaMaxDeg, outerDecMin],
      [outerRaMaxDeg, outerDecMax],
      [outerRaMinDeg, outerDecMax],
    ];

    return {
      tract_id: index,
      ra: center.ra * RAD_TO_DEG,
      dec: center.dec * RAD_TO_DEG,
      inner,
      outer,
    };
  }
}

/** Default LSST sky map configuration */
export const LSST_SKY_MAP = new RingsSkyMap({ numRings: 120, raStart: 0, version: 1 });
