import { describe, expect, it } from 'vitest';
import { readPlotUrl, writePlotUrl } from './plotUrl';

describe('readPlotUrl', () => {
  it('returns empty fields for an empty query string', () => {
    expect(readPlotUrl('')).toEqual({ category: '', plot: '', params: {} });
  });

  it('reads category and plot', () => {
    expect(readPlotUrl('?dq-category=Shape&dq-plot=Residual+Coadd+PSF+Size')).toEqual({
      category: 'Shape',
      plot: 'Residual Coadd PSF Size',
      params: {},
    });
  });

  it('collects the remaining prefixed keys as parameters', () => {
    const { params } = readPlotUrl('?dq-plot=X&dq-band=i&dq-level=high&dq-metric=sigmaMad');
    expect(params).toEqual({ band: 'i', level: 'high', metric: 'sigmaMad' });
  });

  it('ignores keys belonging to the host page', () => {
    const state = readPlotUrl('?highlight=psf&category=Trap&band=z&dq-plot=X&dq-band=i');
    expect(state.plot).toBe('X');
    expect(state.params).toEqual({ band: 'i' });
  });

  it('accepts a query string with no leading question mark', () => {
    expect(readPlotUrl('dq-plot=X').plot).toBe('X');
  });

  it('reports a missing category as empty rather than guessing', () => {
    expect(readPlotUrl('?dq-plot=Stellar+Locus+Scatter').category).toBe('');
  });
});

describe('writePlotUrl', () => {
  const state = { category: 'Photometry', plot: 'PSF-CModel', params: { band: 'r' } };

  it('writes every field under the prefix', () => {
    expect(writePlotUrl('', state)).toBe('dq-category=Photometry&dq-plot=PSF-CModel&dq-band=r');
  });

  it('preserves parameters it does not own', () => {
    expect(writePlotUrl('?highlight=psf', state)).toContain('highlight=psf');
  });

  it('drops stale prefixed keys instead of accumulating them', () => {
    const out = writePlotUrl('?dq-plot=Old&dq-coord=Dec&dq-separation=20', state);
    expect(out).not.toContain('Old');
    expect(out).not.toContain('dq-coord');
    expect(out).not.toContain('dq-separation');
  });

  it('round-trips through readPlotUrl', () => {
    expect(readPlotUrl(writePlotUrl('', state))).toEqual(state);
  });

  it('round-trips a plot name containing spaces and punctuation', () => {
    const awkward = {
      category: 'Detection and Deblending',
      plot: 'Number of Peaks & "others"',
      params: {},
    };
    expect(readPlotUrl(writePlotUrl('', awkward))).toEqual(awkward);
  });
});
