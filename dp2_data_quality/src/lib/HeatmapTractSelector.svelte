<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { geoMtFlatPolarQuartic } from 'd3-geo-projection';
  import { LSST_SKY_MAP } from './ringsSkyMap';
  import Colorbar from './Colorbar.svelte';
  import { createColorScale, type ColormapConfig } from './colorScale';

  let {
    values,
  }: {
    values: Record<number, number>;
  } = $props();

  let container: HTMLDivElement;
  let gRef: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  let pathRef: d3.GeoPath<unknown, d3.GeoPermissibleObjects> | null = null;
  let projectionRef: d3.GeoProjection | null = null;
  let ready = $state(false);

  let colormap = $state<string>('viridis');
  let scaleType = $state<'linear' | 'log' | 'sqrt'>('linear');
  let contrast = $state(1);
  let bias = $state(0.5);
  let userMin = $state<number | undefined>(undefined);
  let userMax = $state<number | undefined>(undefined);

  let tooltip = $state<{ x: number; y: number; tractId: number; value: number } | null>(null);
  let cursorInfo = $state<{ ra: number; dec: number } | null>(null);
  let coordFormat = $state<'hms' | 'deg'>('hms');

  let tractIds = $derived(Object.keys(values).map(Number));
  let hasValues = $derived(tractIds.length > 0);
  let vals = $derived(Object.values(values));
  let dataMin = $derived(d3.min(vals) ?? 0);
  let dataMax = $derived(d3.max(vals) ?? 1);
  let effectiveMin = $derived(userMin ?? dataMin);
  let effectiveMax = $derived(userMax ?? dataMax);

  let effectiveConfig = $derived<ColormapConfig>({
    min: effectiveMin,
    max: effectiveMax,
    colormap,
    scaleType,
    contrast,
    bias,
  });

  let colorScale = $derived(hasValues ? createColorScale(values, effectiveConfig) : () => '#888');
  let tractFill = $derived((tractId: number) => colorScale(values[tractId]));

  function raToLon(ra: number): number {
    return -ra;
  }

  function pixelToSky(x: number, y: number): { ra: number; dec: number } | null {
    const projection = projectionRef;
    if (!projection || !projection.invert) return null;
    const inv = projection.invert([x, y]);
    if (!inv) return null;
    const [lon, lat] = inv;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lat < -90 || lat > 90) return null;
    // Validate: reproject and confirm the point round-trips back near (x, y).
    // The flat-polar projection's inverse returns values for pixels outside the
    // projected map, so we need this guard.
    const reproj = projection([lon, lat]);
    if (!reproj) return null;
    const dx = reproj[0] - x;
    const dy = reproj[1] - y;
    if (dx * dx + dy * dy > 1) return null;
    const ra = (((-lon) % 360) + 360) % 360;
    return { ra, dec: lat };
  }

  function formatRAHMS(ra: number): string {
    const r = (((ra % 360) + 360) % 360) / 15;
    const h = Math.floor(r);
    const mFloat = (r - h) * 60;
    const m = Math.floor(mFloat);
    const s = (mFloat - m) * 60;
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = s.toFixed(2).padStart(5, '0');
    return `${hh}h ${mm}m ${ss}s`;
  }

  function formatDecDMS(dec: number): string {
    const sign = dec < 0 ? '-' : '+';
    const abs = Math.abs(dec);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = (mFloat - m) * 60;
    const dd = String(d).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = s.toFixed(1).padStart(4, '0');
    return `${sign}${dd}° ${mm}' ${ss}"`;
  }

  function formatRA(ra: number): string {
    return coordFormat === 'hms' ? formatRAHMS(ra) : `${ra.toFixed(4)}°`;
  }

  function formatDec(dec: number): string {
    if (coordFormat === 'hms') return formatDecDMS(dec);
    const sign = dec < 0 ? '-' : '+';
    return `${sign}${Math.abs(dec).toFixed(4)}°`;
  }

  function galacticToEquatorial(l_deg: number, b_deg: number): [number, number] {
    const l = (l_deg * Math.PI) / 180;
    const b = (b_deg * Math.PI) / 180;
    const ra_ngp = (192.85948 * Math.PI) / 180;
    const dec_ngp = (27.12825 * Math.PI) / 180;
    const l_ncp = (122.93192 * Math.PI) / 180;

    const sinDec =
      Math.sin(b) * Math.sin(dec_ngp) + Math.cos(b) * Math.cos(dec_ngp) * Math.sin(l - l_ncp);
    const dec = Math.asin(sinDec);
    const cosRaRa = Math.cos(b) * Math.cos(l - l_ncp);
    const sinRaRa =
      Math.sin(b) * Math.cos(dec_ngp) - Math.cos(b) * Math.sin(dec_ngp) * Math.sin(l - l_ncp);
    const ra = (Math.atan2(cosRaRa, sinRaRa) + ra_ngp + 2 * Math.PI) % (2 * Math.PI);
    return [(ra * 180) / Math.PI, (dec * 180) / Math.PI];
  }

  function drawTracts() {
    const g = gRef!;
    const path = pathRef!;
    const projection = projectionRef!;

    g.selectAll('.tract').remove();
    g.selectAll('.tract-label').remove();
    g.selectAll('.galactic-plane-overlay').remove();

    tractIds.forEach((id) => {
      const tract = LSST_SKY_MAP.getTractInfo(id);
      const coords: [number, number][] = tract.inner.map(([ra, dec]) => [raToLon(ra), dec]);
      if (coords.length > 0) coords.push(coords[0]);

      const geoPolygon: d3.GeoPermissibleObjects = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { id: tract.tract_id },
      };

      const tractPath = g
        .append('path')
        .datum(geoPolygon)
        .attr('d', path)
        .attr('class', 'tract')
        .attr('data-id', tract.tract_id);

      tractPath.style('fill', tractFill(tract.tract_id));
      tractPath
        .on('mouseenter', function () {
          d3.select(this).attr('fill-opacity', 0.75);
        })
        .on('mousemove', function (event: MouseEvent) {
          const rect = container.getBoundingClientRect();
          tooltip = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            tractId: tract.tract_id,
            value: values[tract.tract_id],
          };
        })
        .on('mouseleave', function () {
          d3.select(this).attr('fill-opacity', 1.0);
          tooltip = null;
        });

      const pt = projection([raToLon(tract.ra), tract.dec]);
      if (pt) {
        g.append('text')
          .attr('x', pt[0])
          .attr('y', pt[1])
          .attr('class', 'tract-label')
          .text(tract.tract_id);
      }
    });

    // Re-draw galactic plane on top of tracts
    const galacticPlaneCoords: [number, number][] = Array.from({ length: 361 }, (_, i) => {
      const [ra, dec] = galacticToEquatorial(i, 0);
      return [raToLon(ra), dec];
    });
    const gpLineString = { type: 'LineString' as const, coordinates: galacticPlaneCoords };
    g.append('path').datum(gpLineString).attr('d', path).attr('class', 'galactic-plane-overlay');
  }

  let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  let currentZoomK = 1;

  // Size the projection so the full-sky map is as large as possible within the available
  // box, reserving fixed pixel margins for the axis titles/labels drawn outside the sphere.
  // The map's unit-scale extent is 4.4426 wide x 2.6513 tall (aspect ~1.68:1), so a taller
  // box will letterbox above/below — that blank space is the projection shape, not unused area.
  function applyProjection(width: number, height: number) {
    const projection = projectionRef!;
    const projScale = Math.max(1, Math.min((width - 100) / 4.4426, (height - 90) / 2.6513));
    projection.scale(projScale).translate([width / 2, height / 2]);
  }

  // Draw everything that isn't a tract (sphere, graticule, galactic plane, axis labels/titles).
  // Cleared and redrawn from scratch whenever the projection changes (mount or resize).
  function drawStatic() {
    const g = gRef!;
    const path = pathRef!;
    const projection = projectionRef!;

    g.selectAll('*').remove();

    const [tx, ty] = projection.translate();
    const semiA = projection([179.99, 0])![0] - tx;
    const semiB = ty - projection([0, 89.99])![1];

    // Sphere background
    g.append('path')
      .datum({ type: 'Sphere' } as d3.GeoPermissibleObjects)
      .attr('d', path)
      .attr('class', 'sphere-outline')
      .attr('fill', '#ffffff')
      .attr('stroke', '#667')
      .attr('stroke-width', 1.2);

    // Graticule
    const graticule = d3.geoGraticule().step([30, 30]);
    g.append('path')
      .datum(graticule())
      .attr('d', path)
      .attr('class', 'graticule')
      .attr('fill', 'none')
      .attr('stroke', '#bbb')
      .attr('stroke-width', 0.5);

    // Galactic plane
    const galacticPlaneCoords: [number, number][] = Array.from({ length: 361 }, (_, i) => {
      const [ra, dec] = galacticToEquatorial(i, 0);
      return [raToLon(ra), dec];
    });
    const gpLineString = { type: 'LineString' as const, coordinates: galacticPlaneCoords };
    g.append('path').datum(gpLineString).attr('d', path).attr('class', 'galactic-plane');

    // RA labels
    [0, 60, 120, 180, 240, 300].forEach((ra) => {
      const lon = raToLon(ra);
      const ptTop = projection([lon, 89.99]);
      const ptBot = projection([lon, -89.99]);
      if (!ptTop || !ptBot) return;
      g.append('text')
        .attr('class', 'axis-label')
        .attr('x', ptTop[0])
        .attr('y', ptTop[1] - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', '#889')
        .attr('font-size', 10)
        .text(`${ra}°`);
      g.append('text')
        .attr('class', 'axis-label')
        .attr('x', ptBot[0])
        .attr('y', ptBot[1] + 13)
        .attr('text-anchor', 'middle')
        .attr('fill', '#889')
        .attr('font-size', 10)
        .text(`${ra}°`);
    });

    // Dec labels
    [-60, -30, 0, 30, 60].forEach((dec) => {
      const pt = projection([raToLon(180), dec]);
      if (!pt) return;
      g.append('text')
        .attr('class', 'axis-label')
        .attr('x', pt[0] - 8)
        .attr('y', pt[1] + 4)
        .attr('text-anchor', 'end')
        .attr('fill', '#889')
        .attr('font-size', 10)
        .text(`${dec}°`);
    });

    // Axis titles
    g.append('text')
      .attr('class', 'axis-title')
      .attr('x', tx)
      .attr('y', ty + semiB + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', '#aab')
      .attr('font-size', 13)
      .text('Right Ascension');

    g.append('text')
      .attr('class', 'axis-title')
      .attr('transform', `translate(${tx - semiA - 40}, ${ty}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('fill', '#aab')
      .attr('font-size', 13)
      .text('Declination');

    // Keep label sizes consistent with the current zoom level after a redraw.
    g.selectAll('.axis-label').style('font-size', 10 / currentZoomK + 'px');
    g.selectAll('.axis-title').style('font-size', 13 / currentZoomK + 'px');
  }

  onMount(() => {
    let { width, height } = container.getBoundingClientRect();

    svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const projection = geoMtFlatPolarQuartic().rotate([0, 0]);
    projectionRef = projection;
    pathRef = d3.geoPath().projection(projection);
    applyProjection(width, height);

    const g = svg.append('g');
    gRef = g;
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 40])
      .on('zoom', (e) => {
        g.attr('transform', e.transform);
        currentZoomK = e.transform.k;
        g.selectAll('.axis-label').style('font-size', 10 / currentZoomK + 'px');
        g.selectAll('.axis-title').style('font-size', 13 / currentZoomK + 'px');
      });
    svg.call(zoomBehavior);

    svg.on('mousemove.cursor', (event: MouseEvent) => {
      const [px, py] = d3.pointer(event, svg!.node());
      const transform = d3.zoomTransform(svg!.node()!);
      const [x, y] = transform.invert([px, py]);
      cursorInfo = pixelToSky(x, y);
    });
    svg.on('mouseleave.cursor', () => {
      cursorInfo = null;
    });

    drawStatic();
    ready = true;

    // Re-fit the SVG and projection whenever the container changes size — e.g. the colorbar
    // appearing once data loads, or the window being resized. Without this the SVG keeps its
    // mount-time dimensions and the map no longer matches the available area.
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.width === width && rect.height === height) return;
      width = rect.width;
      height = rect.height;
      svg!.attr('width', width).attr('height', height);
      applyProjection(width, height);
      drawStatic();
      drawTracts();
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (ready && gRef && pathRef) {
      drawTracts();
    }
  });

  function handleRangeChange(newMin: number, newMax: number) {
    userMin = newMin;
    userMax = newMax;
  }

  function formatValue(v: number): string {
    if (!Number.isFinite(v)) return String(v);
    const abs = Math.abs(v);
    if (abs === 0) return '0';
    if (abs >= 1000 || abs < 0.01) return v.toExponential(3);
    return v.toPrecision(5);
  }
</script>

<div class="heatmap-tract-selector">
  {#if hasValues}
    <Colorbar
      min={effectiveMin}
      max={effectiveMax}
      {dataMin}
      {dataMax}
      bind:colormap
      bind:scaleType
      bind:contrast
      bind:bias
      onRangeChange={handleRangeChange}
    />
  {/if}
  <div class="tract-map" bind:this={container}>
    <div class="cursor-readout">
      <div class="cursor-row">
        <span class="readout-key">RA</span>
        <span class="cursor-val">{cursorInfo ? formatRA(cursorInfo.ra) : '—'}</span>
      </div>
      <div class="cursor-row">
        <span class="readout-key">Dec</span>
        <span class="cursor-val">{cursorInfo ? formatDec(cursorInfo.dec) : '—'}</span>
      </div>
      <div class="coord-format-toggle">
        <button
          type="button"
          class="format-btn"
          class:active={coordFormat === 'hms'}
          onclick={() => (coordFormat = 'hms')}
        >
          hms
        </button>
        <button
          type="button"
          class="format-btn"
          class:active={coordFormat === 'deg'}
          onclick={() => (coordFormat = 'deg')}
        >
          deg
        </button>
      </div>
    </div>
    {#if tooltip}
      <div class="tooltip" style="left: {tooltip.x + 12}px; top: {tooltip.y + 12}px">
        <div class="tooltip-row"><span class="tooltip-key">Tract</span>{tooltip.tractId}</div>
        <div class="tooltip-row">
          <span class="tooltip-key">Value</span>{formatValue(tooltip.value)}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .heatmap-tract-selector {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  .tract-map {
    position: relative;
    width: 100%;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .tract-map :global(svg) {
    display: block;
  }

  .tract-map :global(.tract) {
    fill: rgba(30, 80, 180, 0.35);
    stroke: #2060c0;
    stroke-width: 0.5;
    vector-effect: non-scaling-stroke;
    transition: fill-opacity 0.1s;
  }

  .tract-map :global(.tract-label) {
    fill: #335;
    font-size: 0.6px;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }

  .tract-map :global(.galactic-plane),
  .tract-map :global(.galactic-plane-overlay) {
    fill: none;
    stroke: #cc3333;
    stroke-width: 1.2;
    stroke-dasharray: 4, 3;
    opacity: 0.8;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .tract-map :global(.graticule) {
    vector-effect: non-scaling-stroke;
  }
  .tract-map :global(.sphere-outline) {
    vector-effect: non-scaling-stroke;
  }

  .cursor-readout {
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    background: rgba(12, 16, 28, 0.85);
    border: 1px solid #334;
    border-radius: 4px;
    padding: 0.3em 0.6em;
    font-size: 0.78rem;
    color: #cce;
    pointer-events: none;
    z-index: 5;
    font-variant-numeric: tabular-nums;
    min-width: 11em;
  }
  .cursor-row {
    display: flex;
    gap: 0.5em;
    align-items: baseline;
  }
  .readout-key {
    color: #889;
    min-width: 2.5em;
  }
  .cursor-val {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
  .coord-format-toggle {
    display: flex;
    gap: 0.25em;
    margin-top: 0.3em;
    pointer-events: auto;
  }
  .format-btn {
    background: #1a1a2e;
    color: #aab;
    border: 1px solid #334;
    border-radius: 3px;
    padding: 0.1em 0.4em;
    font-family: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    flex: 1;
  }
  .format-btn:hover {
    border-color: #4a9eff;
  }
  .format-btn.active {
    background: #4a9eff;
    color: #0b1220;
    border-color: #4a9eff;
  }

  .tooltip {
    position: absolute;
    pointer-events: none;
    background: rgba(12, 16, 28, 0.92);
    border: 1px solid #4a9eff;
    border-radius: 4px;
    padding: 0.35em 0.6em;
    font-size: 0.8rem;
    color: #dde;
    white-space: nowrap;
    z-index: 10;
  }
  .tooltip-row {
    display: flex;
    gap: 0.5em;
    align-items: baseline;
  }
  .tooltip-key {
    color: #889;
    font-size: 0.72rem;
    min-width: 3em;
  }
</style>
