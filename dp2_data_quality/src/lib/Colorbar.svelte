<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { getInterpolator } from './colorScale';
  import ColorbarModal from './ColorbarModal.svelte';

  let {
    min,
    max,
    dataMin,
    dataMax,
    colormap = $bindable('viridis'),
    scaleType = $bindable<'linear' | 'log' | 'sqrt'>('linear'),
    contrast = $bindable(1),
    bias = $bindable(0.5),
    label = '',
    onRangeChange,
  }: {
    min: number;
    max: number;
    dataMin: number;
    dataMax: number;
    colormap?: string;
    scaleType?: 'linear' | 'log' | 'sqrt';
    contrast?: number;
    bias?: number;
    label?: string;
    onRangeChange?: (min: number, max: number) => void;
  } = $props();

  let canvasEl: HTMLCanvasElement;
  let axisContainer: SVGSVGElement;
  let showModal = $state(false);

  const barHeight = 64;
  const axisHeight = 24;

  // Drag state
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartContrast = 1;
  let dragStartBias = 0.5;

  onMount(() => {
    drawColorbar();
  });

  $effect(() => {
    min;
    max;
    colormap;
    scaleType;
    contrast;
    bias;
    if (canvasEl && axisContainer) {
      drawColorbar();
    }
  });

  function drawColorbar() {
    const interpolator = getInterpolator(colormap);
    const width = canvasEl.parentElement?.clientWidth ?? 300;

    canvasEl.width = width;
    canvasEl.height = barHeight;
    const ctx = canvasEl.getContext('2d')!;

    const svgSel = d3.select(axisContainer);
    svgSel.attr('width', width).attr('height', axisHeight);

    const renderPass = (pad: number) => {
      const barLeft = pad;
      const barRight = Math.max(pad + 1, width - pad);
      const barWidth = barRight - barLeft;

      ctx.clearRect(0, 0, width, barHeight);
      for (let i = 0; i < barWidth; i++) {
        const t = i / Math.max(1, barWidth - 1);
        const adjusted = Math.max(0, Math.min(1, contrast * (t - bias) + 0.5));
        ctx.fillStyle = interpolator(adjusted);
        ctx.fillRect(barLeft + i, 0, 1, barHeight);
      }

      svgSel.selectAll('*').remove();
      let scale: d3.ScaleContinuousNumeric<number, number>;
      switch (scaleType) {
        case 'log':
          scale = d3
            .scaleLog()
            .domain([Math.max(min, 1e-10), max])
            .range([barLeft, barRight]);
          break;
        case 'sqrt':
          scale = d3.scaleSqrt().domain([min, max]).range([barLeft, barRight]);
          break;
        default:
          scale = d3.scaleLinear().domain([min, max]).range([barLeft, barRight]);
      }

      // Colours come from the stylesheet so the axis follows the host theme;
      // see the .colorbar-axis rules below.
      const axis = d3.axisBottom(scale).ticks(6);
      svgSel.append('g').attr('class', 'colorbar-axis').call(axis);
    };

    // Iteratively grow horizontal padding until tick labels fit.
    let pad = 8;
    for (let i = 0; i < 3; i++) {
      renderPass(pad);
      const svgRect = axisContainer.getBoundingClientRect();
      let overflow = 0;
      svgSel.selectAll<SVGTextElement, unknown>('.tick text').each(function () {
        const r = this.getBoundingClientRect();
        overflow = Math.max(overflow, svgRect.left - r.left, r.right - svgRect.right);
      });
      if (overflow <= 0) break;
      pad = Math.ceil(pad + overflow + 2);
    }
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartContrast = contrast;
    dragStartBias = bias;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const rect = canvasEl.getBoundingClientRect();
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    // Horizontal drag: shift bias (data midpoint)
    bias = Math.max(0, Math.min(1, dragStartBias + dx / rect.width));

    // Vertical drag: adjust contrast (drag up = more contrast)
    const contrastSensitivity = 4;
    contrast = Math.max(
      0.1,
      Math.min(10, dragStartContrast + (dy / rect.height) * contrastSensitivity),
    );
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    const dx = Math.abs(e.clientX - dragStartX);
    const dy = Math.abs(e.clientY - dragStartY);
    dragging = false;

    // If no significant drag, treat as click → open modal
    if (dx < 3 && dy < 3) {
      showModal = true;
    }
  }

  function handleModalApply(cfg: {
    colormap: string;
    scaleType: 'linear' | 'log' | 'sqrt';
    min: number;
    max: number;
  }) {
    colormap = cfg.colormap;
    scaleType = cfg.scaleType;
    onRangeChange?.(cfg.min, cfg.max);
    // Reset contrast/bias when user sets explicit range
    contrast = 1;
    bias = 0.5;
    showModal = false;
  }
</script>

<div class="colorbar">
  <p class="colorbar-hint">Click to change the colormap. Drag to adjust bias and contrast.</p>
  <canvas
    bind:this={canvasEl}
    style="height: {barHeight}px; width: 100%; display: block; cursor: grab;"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    title="Drag to adjust contrast/bias, click to configure"
  ></canvas>
  <svg bind:this={axisContainer} style="width: 100%; display: block;"></svg>
  {#if label}
    <div class="colorbar-label">{label}</div>
  {/if}
</div>

{#if showModal}
  <ColorbarModal
    {colormap}
    {scaleType}
    {min}
    {max}
    {dataMin}
    {dataMax}
    onApply={handleModalApply}
    onClose={() => {
      showModal = false;
    }}
  />
{/if}

<style>
  .colorbar {
    padding: 4px 1rem;
  }
  /* Neither gesture on the colourbar is guessable, and the click especially so:
     nothing about a gradient suggests it opens a dialog. */
  .colorbar-hint {
    text-align: center;
    color: var(--dq-text-muted);
    font-size: 0.75rem;
    margin: 0 0 2px;
  }

  .colorbar-label {
    text-align: center;
    color: var(--dq-text-muted);
    font-size: 0.8rem;
    margin-top: 2px;
  }

  .colorbar :global(.colorbar-axis text) {
    fill: var(--dq-text-muted);
    font-size: 10px;
  }
  .colorbar :global(.colorbar-axis .domain),
  .colorbar :global(.colorbar-axis .tick line) {
    stroke: var(--dq-border);
  }
</style>
