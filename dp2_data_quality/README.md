# DP2 Data Quality Plots

A web-based data quality visualization tool for the Vera C. Rubin LSST Data Preview 2 (DP2) release. Built with TypeScript and Svelte, it compiles to plain JS, CSS, and HTML so it can be embedded in any web page.

## Features

- Browse data quality plots organized by category (astrometry, detection/deblending, photometry, etc.)
- Filter by observation band (u, g, r, i, z, y)
- View heatmaps of quality metrics across sky survey tracts
- Interact with a sky map showing tract locations with color-coded values; hover a tract to see its ID and value
- Interactive colorbar: drag to adjust contrast/bias, click to open a settings panel for choosing the colormap, scale type, and data range

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+) — npm is included with Node.js. Install Node via your package manager or download from the website:

  ```bash
  # macOS (Homebrew)
  brew install node

  # Ubuntu / Debian
  sudo apt install nodejs npm

  # Or use nvm (any platform)
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install --lts
  ```

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

This starts a local server at `http://localhost:5173` with hot module reloading.

### Build for production

```bash
npm run build
```

The optimized output is written to the `dist/` directory. To preview it locally:

```bash
npm run preview
```

## Project Structure

```
src/
├── main.ts                       # Entry point
├── App.svelte                    # Main layout, category/plot/band selection, and heatmap orchestration
├── app.css                       # Global styles
└── lib/
    ├── HeatmapTractSelector.svelte # Interactive sky map (D3 + geo projections) with embedded colorbar
    ├── Colorbar.svelte           # Interactive color scale with drag and click-to-configure
    ├── ColorbarModal.svelte      # Settings modal for colormap, scale, and range
    ├── colorScale.ts             # D3-based color mapping utilities (15 colormaps)
    └── ringsSkyMap.ts            # TypeScript port of LSST RingsSkyMap
public/
└── data/
    ├── info.json                 # Plot metadata (categories, templates, descriptions)
    └── metrics/                  # Per-band, per-tract metric values (one JSON per heatmap; gitignored, synced via `make data`)
```

## Interactions

### Sky map

- **Pan and zoom** with mouse drag and scroll wheel to navigate the map
- **Hover a tract** to see its ID and metric value in a tooltip

### Colorbar

- **Drag horizontally** to shift the bias (which data value maps to the middle of the color range)
- **Drag vertically** to adjust contrast (how steeply colors change across the range)
- **Click** (without dragging) to open a settings modal where you can:
  - Choose from 15 colormaps (viridis, plasma, inferno, turbo, etc.)
  - Switch between linear, log, and sqrt scaling
  - Set a custom min/max data range
  - Reset everything to defaults

## Data

Plot metadata lives in `public/data/info.json`. The numeric heatmap values live in per-heatmap JSON files under `public/data/metrics/` — one file per `<metric>-<band>-<statistic>` combination, each mapping tract ID to a numeric value (or `null`).

`info.json` specifies the plot categories, the filename template for each heatmap (e.g. `coadd-psf-size-{band}-{level}-{metric}`), and the parameter values used to expand that template into the concrete filenames loaded from `metrics/`.

### Fetching metrics data

`public/data/metrics/` is **not committed to the repo** — it must be populated before the app will render heatmaps. A `Makefile` is provided that wraps `rsync` to sync the directory from the host where the data is generated:

```bash
make data
```

This creates `public/data/metrics/` if needed and mirrors the remote directory into it. The `--delete` flag is passed to `rsync`, so local files that are no longer on the remote will be removed.

The Makefile exposes two variables, both overridable on the command line:

| Variable | Default | Meaning |
|----------|---------|---------|
| `REMOTE` | `slacd:/sdf/home/f/fred3m/u/data/dp2/metrics` | Rsync-style source (`[user@]host:path`). The default targets the SLAC USDF dev node via an SSH config entry named `slacd` — you'll need your own SSH config/host alias for it to resolve. |
| `LOCAL`  | `public/data/metrics` | Local destination, relative to this directory. |

Override either on the command line:

```bash
# Point at a different host / path
make data REMOTE=user@other-host:/path/to/metrics

# Write to a different local directory
make data LOCAL=/absolute/path/to/metrics
```

### Future Implementation

In production we'll probably want all of the all sky tract plots to write to JSON files so that they can be loaded on demand.
We also need a way to connect to a Butler to load all of the plots that we will show. It should probably only be a subset of the ones available at `https://usdf-rsp.slac.stanford.edu/plot-navigator` and titles and descriptions of each plot that will be shown to users should be added to `info.json`.

## Tech Stack

- **Svelte 5** &mdash; reactive UI framework
- **TypeScript** &mdash; static type checking
- **D3.js** &mdash; data visualization and geographic projections
- **Vite** &mdash; build tool and dev server
