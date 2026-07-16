import * as d3 from 'd3';

export interface ColormapConfig {
  min?: number;
  max?: number;
  colormap?: string;
  scaleType?: 'linear' | 'log' | 'sqrt';
  contrast?: number; // default 1, higher = steeper
  bias?: number; // default 0.5, 0 = left, 1 = right
}

const interpolators: Record<string, (t: number) => string> = {
  viridis: d3.interpolateViridis,
  plasma: d3.interpolatePlasma,
  inferno: d3.interpolateInferno,
  magma: d3.interpolateMagma,
  cividis: d3.interpolateCividis,
  turbo: d3.interpolateTurbo,
  warm: d3.interpolateWarm,
  cool: d3.interpolateCool,
  rainbow: d3.interpolateRainbow,
  blues: d3.interpolateBlues,
  greens: d3.interpolateGreens,
  reds: d3.interpolateReds,
  greys: d3.interpolateGreys,
  oranges: d3.interpolateOranges,
  purples: d3.interpolatePurples,
};

export const availableColormaps = Object.keys(interpolators);

export function getInterpolator(name: string): (t: number) => string {
  return interpolators[name] ?? d3.interpolateViridis;
}

export function createColorScale(
  values: Record<number, number>,
  config?: ColormapConfig,
): (value: number) => string {
  const vals = Object.values(values);
  const min = config?.min ?? d3.min(vals) ?? 0;
  const max = config?.max ?? d3.max(vals) ?? 1;
  const scaleType = config?.scaleType ?? 'linear';
  const interpolator = getInterpolator(config?.colormap ?? 'viridis');

  let scale: d3.ScaleContinuousNumeric<number, number>;
  switch (scaleType) {
    case 'log':
      scale = d3
        .scaleLog()
        .domain([Math.max(min, 1e-10), max])
        .range([0, 1])
        .clamp(true);
      break;
    case 'sqrt':
      scale = d3.scaleSqrt().domain([min, max]).range([0, 1]).clamp(true);
      break;
    default:
      scale = d3.scaleLinear().domain([min, max]).range([0, 1]).clamp(true);
  }

  const contrast = config?.contrast ?? 1;
  const bias = config?.bias ?? 0.5;

  return (value: number) => {
    const t = scale(value);
    const adjusted = Math.max(0, Math.min(1, contrast * (t - bias) + 0.5));
    return interpolator(adjusted);
  };
}
