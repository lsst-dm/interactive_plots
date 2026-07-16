<script lang="ts">
  import { onMount } from 'svelte';
  import { getInterpolator, availableColormaps } from './colorScale';

  let {
    colormap = 'viridis',
    scaleType = 'linear' as 'linear' | 'log' | 'sqrt',
    min,
    max,
    dataMin,
    dataMax,
    onApply,
    onClose,
  }: {
    colormap: string;
    scaleType: 'linear' | 'log' | 'sqrt';
    min: number;
    max: number;
    dataMin: number;
    dataMax: number;
    onApply: (cfg: {
      colormap: string;
      scaleType: 'linear' | 'log' | 'sqrt';
      min: number;
      max: number;
    }) => void;
    onClose: () => void;
  } = $props();

  let localColormap = $state(colormap);
  let localScale = $state(scaleType);
  let localMin = $state(String(min));
  let localMax = $state(String(max));

  let swatchCanvases: Map<string, HTMLCanvasElement> = new Map();

  onMount(() => {
    for (const name of availableColormaps) {
      const canvas = swatchCanvases.get(name);
      if (canvas) drawSwatch(canvas, name);
    }
  });

  function drawSwatch(canvas: HTMLCanvasElement, name: string) {
    const interp = getInterpolator(name);
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < w; i++) {
      ctx.fillStyle = interp(i / (w - 1));
      ctx.fillRect(i, 0, 1, h);
    }
  }

  function registerCanvas(el: HTMLCanvasElement, name: string) {
    swatchCanvases.set(name, el);
  }

  function handleApply() {
    const parsedMin = Number(localMin);
    const parsedMax = Number(localMax);
    onApply({
      colormap: localColormap,
      scaleType: localScale,
      min: Number.isFinite(parsedMin) ? parsedMin : dataMin,
      max: Number.isFinite(parsedMax) ? parsedMax : dataMax,
    });
  }

  function handleReset() {
    localMin = String(dataMin);
    localMax = String(dataMax);
    localScale = 'linear';
    localColormap = 'viridis';
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
  <div class="modal">
    <h3>Colorbar Settings</h3>

    <div class="section">
      <span class="field-label">Colormap</span>
      <div class="colormap-grid">
        {#each availableColormaps as name (name)}
          <button
            class="colormap-option"
            class:selected={localColormap === name}
            onclick={() => {
              localColormap = name;
            }}
          >
            <canvas width="100" height="14" use:registerCanvas={name}></canvas>
            <span class="colormap-name">{name}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="section">
      <span class="field-label">Scale</span>
      <div class="scale-options">
        {#each ['linear', 'log', 'sqrt'] as s (s)}
          <button
            class="scale-btn"
            class:selected={localScale === s}
            onclick={() => {
              localScale = s as 'linear' | 'log' | 'sqrt';
            }}>{s}</button
          >
        {/each}
      </div>
    </div>

    <div class="section range-section">
      <span class="field-label">Range</span>
      <div class="range-inputs">
        <label class="range-label">
          Min
          <input type="text" bind:value={localMin} class="range-input" />
        </label>
        <label class="range-label">
          Max
          <input type="text" bind:value={localMax} class="range-input" />
        </label>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-secondary" onclick={handleReset}>Reset</button>
      <div class="action-right">
        <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
        <button class="btn btn-primary" onclick={handleApply}>Apply</button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #1a1a2e;
    border: 1px solid #4a9eff;
    border-radius: 8px;
    padding: 1.25rem;
    width: 380px;
    max-height: 80vh;
    overflow-y: auto;
  }

  h3 {
    margin: 0 0 1rem;
    color: #dde;
    font-size: 1.1rem;
  }

  .section {
    margin-bottom: 1rem;
  }

  .field-label {
    display: block;
    font-size: 0.8rem;
    color: #aab;
    margin-bottom: 0.4rem;
  }

  .colormap-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    max-height: 240px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .colormap-option {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 3px 6px;
    cursor: pointer;
    color: #ccc;
    font-size: 0.75rem;
  }

  .colormap-option:hover {
    border-color: #4a9eff;
  }

  .colormap-option.selected {
    border-color: #4a9eff;
    background: rgba(74, 158, 255, 0.15);
  }

  .colormap-option canvas {
    border-radius: 2px;
    flex-shrink: 0;
  }

  .colormap-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .scale-options {
    display: flex;
    gap: 4px;
  }

  .scale-btn {
    flex: 1;
    padding: 0.35em 0.6em;
    background: transparent;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ccc;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .scale-btn:hover {
    border-color: #4a9eff;
  }

  .scale-btn.selected {
    border-color: #4a9eff;
    background: rgba(74, 158, 255, 0.15);
    color: #4a9eff;
  }

  .range-inputs {
    display: flex;
    gap: 0.75rem;
  }

  .range-label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
    color: #aab;
  }

  .range-input {
    background: #0a0a1a;
    color: #ccc;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 0.35em 0.5em;
    font-size: 0.85rem;
    font-family: inherit;
    width: 100%;
  }

  .range-input:focus {
    border-color: #4a9eff;
    outline: none;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .action-right {
    display: flex;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.4em 1em;
    border-radius: 4px;
    font-size: 0.85rem;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-primary {
    background: #4a9eff;
    color: #fff;
    border-color: #4a9eff;
  }

  .btn-primary:hover {
    background: #3a8eef;
  }

  .btn-secondary {
    background: transparent;
    color: #aab;
    border-color: #555;
  }

  .btn-secondary:hover {
    border-color: #888;
    color: #dde;
  }
</style>
