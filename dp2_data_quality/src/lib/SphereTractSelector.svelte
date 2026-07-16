<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
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
  let baseScale = 1;
  let zoomK = 1;
  const minZoom = 0.5;
  const maxZoom = 40;
  let ready = $state(false);

  let colormap = $state<string>('viridis');
  let scaleType = $state<'linear' | 'log' | 'sqrt'>('linear');
  let contrast = $state(1);
  let bias = $state(0.5);
  let userMin = $state<number | undefined>(undefined);
  let userMax = $state<number | undefined>(undefined);

  let tooltip = $state<{ x: number; y: number; tractId: number; value: number } | null>(null);
  let centerInfo = $state<{ ra: number; dec: number }>({ ra: 0, dec: 0 });
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

  // Returns true if a (lon, lat) point is on the visible (front) hemisphere.
  function isVisible(lon: number, lat: number): boolean {
    const proj = projectionRef!;
    const r = proj.rotate();
    const center: [number, number] = [-r[0], -r[1]];
    return d3.geoDistance(center, [lon, lat]) < Math.PI / 2;
  }

  function pixelToSky(x: number, y: number): { ra: number; dec: number } | null {
    const projection = projectionRef;
    if (!projection || !projection.invert) return null;
    const inv = projection.invert([x, y]);
    if (!inv) return null;
    const [lon, lat] = inv;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (!isVisible(lon, lat)) return null;
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

  // Pre-cache galactic plane coordinates.
  const galacticPlaneCoords: [number, number][] = Array.from({ length: 361 }, (_, i) => {
    const [ra, dec] = galacticToEquatorial(i, 0);
    return [raToLon(ra), dec];
  });

  function drawTracts() {
    const g = gRef!;
    const path = pathRef!;

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
        .attr('data-id', tract.tract_id)
        .attr('data-ra', tract.ra)
        .attr('data-dec', tract.dec);

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

      // Always create the label — redraw() positions and culls it based on current rotation.
      g.append('text')
        .attr('class', 'tract-label')
        .attr('data-ra', tract.ra)
        .attr('data-dec', tract.dec)
        .text(tract.tract_id);
    });

    // Re-draw galactic plane on top of tracts
    const gpLineString = { type: 'LineString' as const, coordinates: galacticPlaneCoords };
    g.append('path').datum(gpLineString).attr('d', path).attr('class', 'galactic-plane-overlay');
  }

  // Update only the geometry-dependent attributes — fast enough to call on every drag/wheel event.
  function redraw() {
    const g = gRef!;
    const path = pathRef!;
    const projection = projectionRef!;

    // Re-path everything that's a path (sphere, graticule, galactic plane, tracts).
    g.selectAll<SVGPathElement, d3.GeoPermissibleObjects>('path').attr('d', path);

    // Reposition + cull any text with attached (ra, dec) data.
    g.selectAll<SVGTextElement, unknown>('text[data-ra][data-dec]').each(function () {
      const sel = d3.select(this);
      const ra = +sel.attr('data-ra');
      const dec = +sel.attr('data-dec');
      const lon = raToLon(ra);
      const pt = projection([lon, dec]);
      if (pt && isVisible(lon, dec)) {
        sel.attr('x', pt[0]).attr('y', pt[1]).style('display', null);
      } else {
        sel.style('display', 'none');
      }
    });

    // Tract labels scale with zoom so they stay proportional to the tract box — tiny when
    // zoomed out, readable when zoomed in, matching the flat selector's transform behavior.
    g.selectAll('.tract-label').style('font-size', `${2 * zoomK}px`);

    const r = projection.rotate();
    centerInfo = { ra: ((-r[0] % 360) + 360) % 360, dec: -r[1] };
  }

  onMount(() => {
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    baseScale = Math.min(width, height) / 2.2;
    const projection = d3
      .geoOrthographic()
      .rotate([0, 0])
      .scale(baseScale)
      .translate([width / 2, height / 2])
      .clipAngle(90);
    projectionRef = projection;

    const path = d3.geoPath().projection(projection);
    pathRef = path;

    const g = svg.append('g');
    gRef = g;

    // Sphere background — single, persistent path that we re-render on rotate/zoom.
    g.append('path')
      .datum({ type: 'Sphere' } as d3.GeoPermissibleObjects)
      .attr('d', path)
      .attr('class', 'sphere-outline')
      .attr('fill', '#0d1426')
      .attr('stroke', '#667')
      .attr('stroke-width', 1.2);

    // Graticule
    const graticule = d3.geoGraticule().step([30, 30]);
    g.append('path')
      .datum(graticule())
      .attr('d', path)
      .attr('class', 'graticule')
      .attr('fill', 'none')
      .attr('stroke', '#445')
      .attr('stroke-width', 0.5);

    // Galactic plane
    const gpLineString = { type: 'LineString' as const, coordinates: galacticPlaneCoords };
    g.append('path').datum(gpLineString).attr('d', path).attr('class', 'galactic-plane');

    // RA labels along the equator at every 30°.
    [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].forEach((ra) => {
      g.append('text')
        .attr('class', 'axis-label ra-label')
        .attr('data-ra', ra)
        .attr('data-dec', 0)
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.4em')
        .text(`${ra}°`);
    });

    // Dec labels along the prime meridian at every 30°.
    [-60, -30, 0, 30, 60].forEach((dec) => {
      g.append('text')
        .attr('class', 'axis-label dec-label')
        .attr('data-ra', 0)
        .attr('data-dec', dec)
        .attr('text-anchor', 'start')
        .attr('dx', '0.4em')
        .text(`${dec}°`);
    });

    // Drag to rotate. Sensitivity scales inversely with current projection scale so dragging
    // feels consistent at any zoom level.
    const dragBehavior = d3
      .drag<SVGSVGElement, unknown>()
      .on('drag', (event: d3.D3DragEvent<SVGSVGElement, unknown, unknown>) => {
        const r = projection.rotate();
        const k = 75 / projection.scale();
        const newLambda = r[0] + event.dx * k;
        const newPhi = Math.max(-90, Math.min(90, r[1] - event.dy * k));
        projection.rotate([newLambda, newPhi, r[2] ?? 0]);
        redraw();
      });
    svg.call(dragBehavior);

    // Track cursor position and report RA/Dec of the point under the pointer.
    svg.on('mousemove.cursor', (event: MouseEvent) => {
      const [x, y] = d3.pointer(event, svg.node());
      cursorInfo = pixelToSky(x, y);
    });
    svg.on('mouseleave.cursor', () => {
      cursorInfo = null;
    });

    // Wheel to zoom — adjusts projection scale (so strokes/text stay crisp).
    svg.on('wheel', (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.001);
      const nextK = Math.max(minZoom, Math.min(maxZoom, zoomK * factor));
      if (nextK === zoomK) return;
      zoomK = nextK;
      projection.scale(baseScale * zoomK);
      redraw();
    });

    redraw();
    ready = true;

    // Re-fit the SVG and projection whenever the container changes size — e.g. the colorbar
    // appearing once data loads, or the window being resized.
    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      svg.attr('width', r.width).attr('height', r.height);
      baseScale = Math.min(r.width, r.height) / 2.2;
      projection.scale(baseScale * zoomK).translate([r.width / 2, r.height / 2]);
      redraw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (ready && gRef && pathRef) {
      drawTracts();
      redraw();
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

<div class="sphere-tract-selector">
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
    <div class="center-readout">
      <span class="readout-key">RA</span><span class="cursor-val">{formatRA(centerInfo.ra)}</span>
      <span class="readout-sep">·</span>
      <span class="readout-key">Dec</span><span class="cursor-val">{formatDec(centerInfo.dec)}</span>
    </div>
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
  .sphere-tract-selector {
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
    cursor: grab;
  }
  .tract-map :global(svg) {
    display: block;
    touch-action: none;
  }
  .tract-map:active {
    cursor: grabbing;
  }

  .tract-map :global(.tract) {
    fill: rgba(30, 80, 180, 0.35);
    stroke: #2060c0;
    stroke-width: 0.5;
    transition: fill-opacity 0.1s;
  }

  .tract-map :global(.tract-label) {
    fill: #cce;
    font-size: 8px;
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
    pointer-events: none;
  }

  .tract-map :global(.axis-label) {
    fill: #aab;
    font-size: 11px;
    pointer-events: none;
    user-select: none;
  }
  .tract-map :global(.ra-label) {
    font-weight: 500;
  }
  .tract-map :global(.dec-label) {
    fill: #99a;
  }

  .center-readout {
    position: absolute;
    top: 0.5rem;
    left: 0.75rem;
    background: rgba(12, 16, 28, 0.75);
    border: 1px solid #334;
    border-radius: 4px;
    padding: 0.3em 0.6em;
    font-size: 0.78rem;
    color: #cce;
    pointer-events: none;
    z-index: 5;
    font-variant-numeric: tabular-nums;
  }
  .readout-key {
    color: #889;
    margin-right: 0.3em;
  }
  .readout-sep {
    color: #556;
    margin: 0 0.4em;
  }

  .cursor-readout {
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    background: rgba(12, 16, 28, 0.75);
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
