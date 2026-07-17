<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import HeatmapTractSelector from './lib/HeatmapTractSelector.svelte';
  import SphereTractSelector from './lib/SphereTractSelector.svelte';
  import HelpModal from './lib/HelpModal.svelte';

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

  // Resolved against this module's own URL rather than the site root: the
  // bundle and its data ship together into a directory whose prefix differs
  // between dp2.lsst.io, a /v/<branch>/ preview, and the dev server.
  const DATA_URL = new URL('./data/', import.meta.url);

  let info = $state<Info | null>(null);
  let selectedCategory = $state('');
  let selectedPlot = $state('');
  let selectedBand = $state<string>('');
  let paramSelections = $state<Record<string, string | number>>({});
  let heatmapValues = $state<Record<number, number>>({});
  let projectionMode = $state<'flat' | 'sphere'>('flat');
  let showHelp = $state(false);

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
    const resp = await fetch(new URL('info.json', DATA_URL));
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
    fetch(new URL(`metrics/${filename}.json`, DATA_URL)).then(async (resp) => {
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

<main>
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
      <button
        type="button"
        class="help-btn"
        onclick={() => (showHelp = true)}
        aria-label="How to use these plots"
        title="How to use these plots"
      >
        ?
      </button>
    </div>
    {#if projectionMode === 'flat'}
      <HeatmapTractSelector values={heatmapValues} />
    {:else}
      <SphereTractSelector values={heatmapValues} />
    {/if}
  </section>

  <aside class="controls">
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
</main>

{#if showHelp}
  <HelpModal {projectionMode} onClose={() => (showHelp = false)} />
{/if}

<style>
  /* Fills the mount point, which is sized by app.css. The map is stacked above
     the controls rather than beside them: the page's own navigation already
     occupies the left of the viewport, so a second vertical rail would leave
     the map with a narrow strip of what is already a narrow content column. */
  main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.75rem 1.25rem;
    padding: 0.75rem 0.25rem 0;
    border-top: 1px solid var(--dq-border);
    flex: none;
  }

  .loading {
    color: var(--dq-text-muted);
    font-size: 0.85rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: var(--dq-text-muted);
    margin: 0;
    padding: 0;
    border: none;
    min-width: 9rem;
  }

  select {
    background: var(--dq-surface);
    color: var(--dq-text);
    border: 1px solid var(--dq-accent);
    border-radius: 4px;
    padding: 0.4em 0.6em;
    font-family: inherit;
    font-size: 0.85rem;
    width: 100%;
  }

  select:focus {
    outline: 2px solid var(--dq-accent);
    outline-offset: 1px;
  }

  .band-field legend {
    font-size: 0.85rem;
    color: var(--dq-text-muted);
    padding: 0;
  }

  .band-options {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .band-btn {
    background: var(--dq-surface);
    color: var(--dq-text);
    border: 1px solid var(--dq-border);
    border-radius: 4px;
    padding: 0.25em 0.6em;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-width: 2em;
  }
  .band-btn:hover {
    border-color: var(--dq-accent);
  }
  .band-btn.active {
    background: var(--dq-accent);
    color: var(--dq-on-accent);
    border-color: var(--dq-accent);
  }

  /* Takes the remaining width of the control row so long descriptions wrap
     alongside the selectors rather than pushing them apart. */
  .description {
    flex: 1 1 18rem;
    min-width: 14rem;
  }
  .description h3 {
    font-size: 0.9rem;
    color: var(--dq-text);
    margin: 0 0 0.25rem;
  }
  .description p {
    font-size: 0.8rem;
    color: var(--dq-text-muted);
    line-height: 1.5;
    margin: 0;
  }

  .map {
    flex: 1;
    min-height: 0;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .projection-toggle {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0 0.25rem;
  }

  /* Right-aligned, away from Flat/Sphere: it is not a third view. */
  .help-btn {
    margin-left: auto;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    background: var(--dq-surface);
    color: var(--dq-text-muted);
    border: 1px solid var(--dq-border);
    font-family: inherit;
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
  }
  .help-btn:hover {
    border-color: var(--dq-accent);
    color: var(--dq-accent);
  }
  .toggle-btn {
    background: var(--dq-surface);
    color: var(--dq-text);
    border: 1px solid var(--dq-border);
    border-radius: 4px;
    padding: 0.25em 0.7em;
    font-family: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .toggle-btn:hover {
    border-color: var(--dq-accent);
  }
  .toggle-btn.active {
    background: var(--dq-accent);
    color: var(--dq-on-accent);
    border-color: var(--dq-accent);
  }

  @media (max-width: 700px) {
    .controls {
      gap: 0.75rem;
    }
    .field,
    .description {
      min-width: 100%;
    }
  }
</style>
