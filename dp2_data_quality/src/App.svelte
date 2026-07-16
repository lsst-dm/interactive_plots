<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import HeatmapTractSelector from './lib/HeatmapTractSelector.svelte';
  import SphereTractSelector from './lib/SphereTractSelector.svelte';

  interface PlotEntry {
    template: string;
    parameters?: Record<string, (string | number)[]>;
    description?: string;
  }

  interface Info {
    categories: Record<string, Record<string, PlotEntry>>;
  }

  const BAND_ORDER = ['u', 'g', 'r', 'i', 'z', 'y'];
  const DEFAULT_BAND = 'r';

  let info = $state<Info | null>(null);
  let selectedCategory = $state('');
  let selectedPlot = $state('');
  let selectedBand = $state<string>('');
  let paramSelections = $state<Record<string, string | number>>({});
  let heatmapValues = $state<Record<number, number>>({});
  let projectionMode = $state<'flat' | 'sphere'>('flat');

  let nonEmptyCategories = $derived(
    info
      ? Object.keys(info.categories).filter((c) => Object.keys(info!.categories[c]).length > 0)
      : [],
  );
  let plotsInCategory = $derived(
    info && selectedCategory ? Object.keys(info.categories[selectedCategory] ?? {}) : [],
  );
  let currentEntry = $derived(
    info && selectedCategory && selectedPlot
      ? (info.categories[selectedCategory]?.[selectedPlot] ?? null)
      : null,
  );
  let availableBands = $derived.by<string[]>(() => {
    const bandParam = currentEntry?.parameters?.band;
    if (!bandParam) return [];
    const bandSet = new Set(bandParam.map(String));
    return BAND_ORDER.filter((b) => bandSet.has(b));
  });
  let otherParams = $derived.by<[string, (string | number)[]][]>(() => {
    const params = currentEntry?.parameters;
    if (!params) return [];
    return Object.entries(params).filter(([k]) => k !== 'band');
  });

  onMount(async () => {
    const resp = await fetch('/data/info.json');
    info = (await resp.json()) as Info;
  });

  // Initialize category/plot defaults when info arrives or current category empties.
  $effect(() => {
    if (!info) return;
    const cats = nonEmptyCategories;
    if (cats.length === 0) return;
    if (!cats.includes(selectedCategory)) {
      untrack(() => {
        selectedCategory = cats[0];
      });
    }
  });

  // When category changes, pick a plot default.
  $effect(() => {
    const plots = plotsInCategory;
    if (plots.length === 0) {
      untrack(() => {
        selectedPlot = '';
      });
      return;
    }
    if (!plots.includes(untrack(() => selectedPlot))) {
      untrack(() => {
        selectedPlot = plots[0];
      });
    }
  });

  // When entry changes, reconcile band + paramSelections, preserving prior choices when valid.
  $effect(() => {
    const entry = currentEntry;
    if (!entry) return;
    const bands = availableBands;
    const params = otherParams;
    untrack(() => {
      if (bands.length > 0) {
        if (!bands.includes(selectedBand)) {
          selectedBand = bands.includes(DEFAULT_BAND) ? DEFAULT_BAND : bands[0];
        }
      } else {
        selectedBand = '';
      }

      const next: Record<string, string | number> = {};
      for (const [key, values] of params) {
        const prev = paramSelections[key];
        next[key] = values.includes(prev) ? prev : values[0];
      }
      paramSelections = next;
    });
  });

  // Fetch heatmap data whenever the resolved template changes.
  let fetchSeq = 0;
  $effect(() => {
    const entry = currentEntry;
    if (!entry) {
      heatmapValues = {};
      return;
    }
    const substitutions: Record<string, string | number> = { ...paramSelections };
    if (entry.parameters?.band) substitutions.band = selectedBand;

    // If any placeholder isn't resolved yet, skip the fetch.
    const placeholders = [...entry.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (placeholders.some((p) => !(p in substitutions) || substitutions[p] === '')) return;

    const filename = entry.template.replace(/\{(\w+)\}/g, (_, k) => String(substitutions[k]));
    const seq = ++fetchSeq;
    fetch(`/data/metrics/${filename}.json`).then(async (resp) => {
      if (seq !== fetchSeq) return;
      if (!resp.ok) {
        heatmapValues = {};
        return;
      }
      const raw = (await resp.json()) as Record<string, number | null>;
      const cleaned: Record<number, number> = {};
      for (const [tractId, value] of Object.entries(raw)) {
        if (value !== null && Number.isFinite(value)) cleaned[Number(tractId)] = value;
      }
      if (seq === fetchSeq) heatmapValues = cleaned;
    });
  });

  function onCategoryChange(e: Event) {
    selectedCategory = (e.target as HTMLSelectElement).value;
  }
  function onPlotChange(e: Event) {
    selectedPlot = (e.target as HTMLSelectElement).value;
  }
  function onParamChange(key: string, value: string) {
    const values = currentEntry?.parameters?.[key] ?? [];
    const numeric = values.find((v) => typeof v === 'number' && String(v) === value);
    paramSelections = { ...paramSelections, [key]: numeric !== undefined ? numeric : value };
  }
</script>

<header>
  <h1>DP2 Data Quality</h1>
</header>

<main>
  <aside class="sidebar">
    {#if info === null}
      <div class="loading">Loading…</div>
    {:else}
      <label class="field">
        Category
        <select value={selectedCategory} onchange={onCategoryChange}>
          {#each nonEmptyCategories as cat (cat)}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        Plot
        <select value={selectedPlot} onchange={onPlotChange}>
          {#each plotsInCategory as plot (plot)}
            <option value={plot}>{plot}</option>
          {/each}
        </select>
      </label>

      {#if availableBands.length > 0}
        <fieldset class="field band-field">
          <legend>Band</legend>
          <div class="band-options">
            {#each availableBands as band (band)}
              <button
                type="button"
                class="band-btn"
                class:active={selectedBand === band}
                onclick={() => (selectedBand = band)}
              >
                {band}
              </button>
            {/each}
          </div>
        </fieldset>
      {/if}

      {#each otherParams as [key, values] (key)}
        <label class="field">
          {key}
          <select
            value={String(paramSelections[key] ?? '')}
            onchange={(e) => onParamChange(key, (e.target as HTMLSelectElement).value)}
          >
            {#each values as v (v)}
              <option value={String(v)}>{v}</option>
            {/each}
          </select>
        </label>
      {/each}

      {#if currentEntry?.description}
        <section class="description">
          <h3>{selectedPlot}</h3>
          <p>{currentEntry.description}</p>
        </section>
      {/if}
    {/if}
  </aside>

  <section class="map">
    <div class="projection-toggle">
      <button
        type="button"
        class="toggle-btn"
        class:active={projectionMode === 'flat'}
        onclick={() => (projectionMode = 'flat')}
      >
        Flat
      </button>
      <button
        type="button"
        class="toggle-btn"
        class:active={projectionMode === 'sphere'}
        onclick={() => (projectionMode = 'sphere')}
      >
        Sphere
      </button>
    </div>
    {#if projectionMode === 'flat'}
      <HeatmapTractSelector values={heatmapValues} />
    {:else}
      <SphereTractSelector values={heatmapValues} />
    {/if}
  </section>
</main>

<style>
  header {
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid #333;
  }

  h1 {
    font-size: 1.4rem;
    margin: 0;
    color: #dde;
  }

  main {
    display: flex;
    height: calc(100vh - 3.5rem);
  }

  .sidebar {
    width: 240px;
    min-width: 200px;
    padding: 1rem;
    border-right: 1px solid #333;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .loading {
    color: #889;
    font-size: 0.85rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #aab;
    margin: 0;
    padding: 0;
    border: none;
  }

  select {
    background: #1a1a2e;
    color: #ccc;
    border: 1px solid #4a9eff;
    border-radius: 4px;
    padding: 0.4em 0.6em;
    font-family: inherit;
    font-size: 0.85rem;
    width: 100%;
  }

  select:focus {
    outline: 2px solid #4a9eff;
    outline-offset: 1px;
  }

  .band-field legend {
    font-size: 0.85rem;
    color: #aab;
    padding: 0;
  }

  .band-options {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .band-btn {
    background: #1a1a2e;
    color: #ccc;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 0.25em 0.6em;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-width: 2em;
  }
  .band-btn:hover {
    border-color: #4a9eff;
  }
  .band-btn.active {
    background: #4a9eff;
    color: #0b1220;
    border-color: #4a9eff;
  }

  .description {
    padding-top: 0.5rem;
    border-top: 1px solid #333;
  }
  .description h3 {
    font-size: 0.9rem;
    color: #dde;
    margin: 0 0 0.5rem;
  }
  .description p {
    font-size: 0.8rem;
    color: #aab;
    line-height: 1.5;
    margin: 0;
  }

  .map {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .projection-toggle {
    display: flex;
    gap: 0.3rem;
    padding: 0.5rem 0.75rem 0;
  }
  .toggle-btn {
    background: #1a1a2e;
    color: #ccc;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 0.25em 0.7em;
    font-family: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .toggle-btn:hover {
    border-color: #4a9eff;
  }
  .toggle-btn.active {
    background: #4a9eff;
    color: #0b1220;
    border-color: #4a9eff;
  }

  @media (max-width: 700px) {
    main {
      flex-direction: column;
      height: auto;
    }
    .sidebar {
      width: auto;
      border-right: none;
      border-bottom: 1px solid #333;
    }
    .map {
      min-height: 60vh;
    }
  }
</style>
