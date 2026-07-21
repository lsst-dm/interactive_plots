<script lang="ts">
  let {
    projectionMode,
    onClose,
  }: {
    projectionMode: 'flat' | 'sphere';
    onClose: () => void;
  } = $props();

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
<div class="dq-modal-backdrop" onclick={handleBackdropClick}>
  <div class="dq-modal">
    <h3>Using these plots</h3>

    <section>
      <h4>{projectionMode === 'sphere' ? 'Sphere view' : 'Flat view'}</h4>
      <dl>
        {#if projectionMode === 'sphere'}
          <dt>Drag</dt>
          <dd>Rotate the globe</dd>
        {:else}
          <dt>Drag</dt>
          <dd>Pan across the map</dd>
        {/if}
        <dt>Scroll</dt>
        <dd>Zoom in and out</dd>
        <dt>Hover a tract</dt>
        <dd>Show its number and value</dd>
      </dl>
    </section>

    <section>
      <h4>Colorbar</h4>
      <dl>
        <dt>Click</dt>
        <dd>Choose a colormap, scale, and data range</dd>
        <dt>Drag left or right</dt>
        <dd>Shift the bias</dd>
        <dt>Drag up or down</dt>
        <dd>Adjust the contrast</dd>
      </dl>
    </section>

    <div class="actions">
      <button class="dq-btn dq-btn-primary" onclick={onClose}>Close</button>
    </div>
  </div>
</div>

<style>
  /* Mirrors ColorbarModal: the dq- prefix keeps these clear of Bootstrap, which the
     host page ships and whose own .modal sets display:none. */
  .dq-modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--dq-backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .dq-modal {
    background: var(--dq-surface);
    border: 1px solid var(--dq-accent);
    border-radius: 8px;
    padding: 1.25rem;
    width: 380px;
    max-height: 80vh;
    overflow-y: auto;
  }

  h3 {
    margin: 0 0 1rem;
    color: var(--dq-text);
    font-size: 1.1rem;
  }

  h4 {
    margin: 0 0 0.4rem;
    color: var(--dq-text-muted);
    font-size: 0.8rem;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  section {
    margin-bottom: 1rem;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.3rem 0.75rem;
    margin: 0;
    font-size: 0.85rem;
  }

  dt {
    color: var(--dq-text);
    white-space: nowrap;
  }

  dd {
    color: var(--dq-text-muted);
    margin: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }

  .dq-btn {
    padding: 0.4em 1em;
    border-radius: 4px;
    border: 1px solid transparent;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .dq-btn-primary {
    background: var(--dq-accent);
    color: var(--dq-on-accent);
    border-color: var(--dq-accent);
  }

  .dq-btn-primary:hover {
    background: color-mix(in srgb, var(--dq-accent) 85%, black);
  }
</style>
