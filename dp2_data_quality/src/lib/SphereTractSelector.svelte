<script lang="ts">
  import { onMount, untrack } from 'svelte';
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

  // Tract label size as a fraction of the projected sphere radius, so a label keeps
  // its proportion to a tract at any container size.
  //
  // Sized against the flat selector's labels on screen rather than in proportion to
  // a tract. The orthographic globe fills the pane with half the sky (~5 px/degree)
  // while the flat projection fits all of it (~1.9 px/degree), so a label taking the
  // same share of a tract in both views still renders far larger here.
  const LABEL_SCALE = 1 / 300;
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
    const ra = ((-lon % 360) + 360) % 360;
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

  // Keyed by tract id so a plot change reuses the nodes it already has. Rebuilding
  // them costs more than the DOM work alone: this app is embedded in a page whose
  // theme holds a MutationObserver over the article with {childList: true, subtree:
  // true}, so every node added or removed here is a mutation record it has to queue
  // and process. Recolouring in place touches attributes only, which that observer
  // does not watch, so a bias/contrast drag or a colormap change costs it nothing.
  type TractFeature = d3.GeoPermissibleObjects & {
    properties: { id: number; ra: number; dec: number };
  };

  function tractFeature(id: number): TractFeature {
    const tract = LSST_SKY_MAP.getTractInfo(id);
    const coords: [number, number][] = tract.inner.map(([ra, dec]) => [raToLon(ra), dec]);
    if (coords.length > 0) coords.push(coords[0]);
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: { id: tract.tract_id, ra: tract.ra, dec: tract.dec },
    } as TractFeature;
  }

  // Fill only. Cheap enough to call on every frame of a colorbar drag.
  function paintTracts() {
    gRef!
      .selectAll<SVGPathElement, TractFeature>('.tract')
      .style('fill', (d) => tractFill(d.properties.id));
  }

  function drawTracts() {
    const g = gRef!;
    const path = pathRef!;

    g.selectAll('.galactic-plane-overlay').remove();

    const features = tractIds.map(tractFeature);
    const key = (d: TractFeature) => String(d.properties.id);

    const tracts = g.selectAll<SVGPathElement, TractFeature>('.tract').data(features, key);
    tracts.exit().remove();
    tracts
      .enter()
      .append('path')
      .attr('class', 'tract')
      .attr('data-id', (d) => d.properties.id)
      .attr('data-ra', (d) => d.properties.ra)
      .attr('data-dec', (d) => d.properties.dec)
      .on('mouseenter', function () {
        d3.select(this).attr('fill-opacity', 0.75);
      })
      .on('mousemove', function (event: MouseEvent, d) {
        const rect = container.getBoundingClientRect();
        tooltip = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          tractId: d.properties.id,
          value: values[d.properties.id],
        };
      })
      .on('mouseleave', function () {
        d3.select(this).attr('fill-opacity', 1.0);
        tooltip = null;
      })
      .merge(tracts)
      .attr('d', path);

    // redraw() positions and culls these by rotation; only membership changes here.
    const labels = g.selectAll<SVGTextElement, TractFeature>('.tract-label').data(features, key);
    labels.exit().remove();
    labels
      .enter()
      .append('text')
      .attr('class', 'tract-label')
      .attr('data-ra', (d) => d.properties.ra)
      .attr('data-dec', (d) => d.properties.dec)
      .text((d) => d.properties.id);

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

    // Tract labels are a fixed fraction of the sphere's projected radius, so they stay
    // proportional to the tract box at any container size: tiny when zoomed out, readable
    // when zoomed in, matching the flat selector's transform behavior. Scaling by zoom
    // alone holds only while the container never changes size; the sphere shrinks with the
    // pane but such a label would not, and would swallow the tract it names.
    g.selectAll('.tract-label').style('font-size', `${baseScale * zoomK * LABEL_SCALE}px`);

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
      .attr('stroke-width', 1.2);

    // Graticule
    const graticule = d3.geoGraticule().step([30, 30]);
    g.append('path')
      .datum(graticule())
      .attr('d', path)
      .attr('class', 'graticule')
      .attr('fill', 'none')
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

  // Metrics differ by orders of magnitude between plots, so a range, scale, or bias
  // chosen for one is meaningless against the next and can map the whole sky to a
  // single colour. Reset to the new data's own bounds on a linear scale whenever the
  // values change. The colormap survives: the scheme is the reader's preference, the
  // range is a property of the data.
  //
  // Declared before the effects below so it runs first, and they see the reset values.
  $effect(() => {
    values;
    untrack(() => {
      userMin = undefined;
      userMax = undefined;
      scaleType = 'linear';
      contrast = 1;
      bias = 0.5;
    });
  });

  // Structure: only when the set of tracts changes. Reads tractIds and nothing
  // colour-related, so a colormap or contrast change cannot land here.
  $effect(() => {
    tractIds;
    if (ready && gRef && pathRef) {
      untrack(() => {
        drawTracts();
        redraw();
        paintTracts();
      });
    }
  });

  // Colour: every colormap, range, contrast, and bias change comes through here and
  // touches nothing but the fill.
  $effect(() => {
    colorScale;
    if (ready && gRef) untrack(() => paintTracts());
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
      <span class="readout-key">Dec</span><span class="cursor-val">{formatDec(centerInfo.dec)}</span
      >
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
      <div class="dq-tooltip" style="left: {tooltip.x + 12}px; top: {tooltip.y + 12}px">
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

  /* Tract fill and label are set against the colormap, not the page, so they
     stay fixed: a tract with no value reads the same in either theme, and the
     label has to survive whatever colour the scale puts under it. */
  .tract-map :global(.tract) {
    fill: rgba(30, 80, 180, 0.35);
    stroke: #2060c0;
    stroke-width: 0.5;
    transition: fill-opacity 0.1s;
  }

  /* Dark, matching the flat selector: a label sits on a colormap-filled tract, and
     the bright end of most colormaps (yellow, white) leaves light text unreadable.
     font-size is set in redraw(), which scales it with the projection. */
  .tract-map :global(.tract-label) {
    fill: #335;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }

  .tract-map :global(.galactic-plane),
  .tract-map :global(.galactic-plane-overlay) {
    fill: none;
    stroke: var(--dq-galactic-plane);
    stroke-width: 1.2;
    stroke-dasharray: 4, 3;
    opacity: 0.8;
    pointer-events: none;
  }

  .tract-map :global(.sphere-outline) {
    fill: var(--dq-map-bg);
    stroke: var(--dq-border);
  }
  .tract-map :global(.graticule) {
    fill: none;
    stroke: var(--dq-border);
  }

  .tract-map :global(.axis-label) {
    fill: var(--dq-text-muted);
    font-size: 11px;
    pointer-events: none;
    user-select: none;
  }
  .tract-map :global(.ra-label) {
    font-weight: 500;
  }
  .tract-map :global(.dec-label) {
    fill: var(--dq-text-muted);
  }

  .center-readout {
    position: absolute;
    top: 0.5rem;
    left: 0.75rem;
    background: var(--dq-panel);
    border: 1px solid var(--dq-border);
    border-radius: 4px;
    padding: 0.3em 0.6em;
    font-size: 0.78rem;
    color: var(--dq-text);
    pointer-events: none;
    z-index: 5;
    font-variant-numeric: tabular-nums;
  }
  .readout-key {
    color: var(--dq-text-muted);
    margin-right: 0.3em;
  }
  .readout-sep {
    color: var(--dq-text-muted);
    margin: 0 0.4em;
  }

  .cursor-readout {
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    background: var(--dq-panel);
    border: 1px solid var(--dq-border);
    border-radius: 4px;
    padding: 0.3em 0.6em;
    font-size: 0.78rem;
    color: var(--dq-text);
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
    background: var(--dq-surface);
    color: var(--dq-text-muted);
    border: 1px solid var(--dq-border);
    border-radius: 3px;
    padding: 0.1em 0.4em;
    font-family: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    flex: 1;
  }
  .format-btn:hover {
    border-color: var(--dq-accent);
  }
  .format-btn.active {
    background: var(--dq-accent);
    color: var(--dq-on-accent);
    border-color: var(--dq-accent);
  }

  .dq-tooltip {
    position: absolute;
    pointer-events: none;
    background: var(--dq-panel);
    border: 1px solid var(--dq-accent);
    border-radius: 4px;
    padding: 0.35em 0.6em;
    font-size: 0.8rem;
    color: var(--dq-text);
    white-space: nowrap;
    z-index: 10;
  }
  .tooltip-row {
    display: flex;
    gap: 0.5em;
    align-items: baseline;
  }
  .tooltip-key {
    color: var(--dq-text-muted);
    font-size: 0.72rem;
    min-width: 3em;
  }
</style>
