// A plot selection round-trips through the query string so a reader can link to
// the exact view they are looking at.
//
// Keys are prefixed because the app is embedded in a Sphinx page that owns the
// same URL and puts its own parameters there (`highlight` on a search hit, for
// one). Reading ignores anything unprefixed and writing preserves it.
const PREFIX = 'dq-';

export interface PlotUrlState {
  category: string;
  plot: string;
  /** Parameter selections keyed by the names in info.json, `band` among them. */
  params: Record<string, string>;
}

export function readPlotUrl(search: string): PlotUrlState {
  const query = new URLSearchParams(search);
  const params: Record<string, string> = {};
  for (const [key, value] of query) {
    if (!key.startsWith(PREFIX)) continue;
    const name = key.slice(PREFIX.length);
    if (name !== 'category' && name !== 'plot') params[name] = value;
  }
  return {
    category: query.get(`${PREFIX}category`) ?? '',
    plot: query.get(`${PREFIX}plot`) ?? '',
    params,
  };
}

/** Returns the new query string, carrying over any parameter this app does not own. */
export function writePlotUrl(search: string, state: PlotUrlState): string {
  const query = new URLSearchParams(search);
  for (const key of [...query.keys()]) {
    if (key.startsWith(PREFIX)) query.delete(key);
  }
  query.set(`${PREFIX}category`, state.category);
  query.set(`${PREFIX}plot`, state.plot);
  for (const [name, value] of Object.entries(state.params)) {
    query.set(`${PREFIX}${name}`, value);
  }
  return query.toString();
}
