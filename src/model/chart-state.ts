/**
 * Serialisable chart state — the keystone the persistence-shaped features hang
 * off (saved layouts, templates, an objects panel, favourites, drawings).
 *
 * The rule that shapes this type: **the chart serialises what the chart owns.**
 * Series *data* is the application's — it knows the symbol, the timeframe, and
 * the feed — so `restoreState` never recreates series. It restores the things
 * the chart is the source of truth for (viewport, grid, panes, price scales,
 * indicators) and reports the series it saw so an app can rebuild them itself
 * and re-apply their styling.
 */
import type { SeriesStyle } from '../render/series-style';
import type { PriceScaleId } from './series';
import type { IndicatorSettings } from './indicator-registry';
import type { PriceScaleMode } from '../scale/price-scale';
import type { AlertsDocument } from '../alerts/types';

/** Bumped when the shape changes incompatibly; `restoreState` ignores unknown versions. */
export const CHART_STATE_VERSION = 1;

export interface PriceScaleState {
  marginTop: number;
  marginBottom: number;
  minMove: number;
  /** Optional in older snapshots, which used the current scale's precision floor. */
  minPrecision?: number;
  mode: PriceScaleMode;
  inverted: boolean;
  /** False when the user (or an indicator's fixed range) pinned the scale. */
  autoScale: boolean;
  /** The pinned range, present only when `autoScale` is false. */
  range?: { min: number; max: number };
  /** The declared auto-fit band, independent of a temporary manual range. */
  fixedRange?: { min: number; max: number } | null;
  /** Study default ownership; manual records a host view override without losing the default. */
  indicatorRange?: { instanceId: string; manual: boolean };
  /** Geometry paired with the saved range, so reopening at another size preserves its proportion. */
  ratioLock?: { barSpacing: number; height: number };
}

export interface PaneState {
  /** Relative height weight among panes. */
  weight: number;
  priceScale: PriceScaleState;
  /** Secondary scales only; the right scale remains in priceScale for older readers. */
  scales?: Partial<Record<PriceScaleId, PriceScaleState>>;
}

function stateRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Invalid pane scale object');
  if (Object.values(Object.getOwnPropertyDescriptors(input)).some(property => !('value' in property))) {
    throw new Error('Pane scale accessors are not supported');
  }
  return input as Record<string, unknown>;
}

function stateNumber(value: unknown, label: string, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
  return value;
}

function stateRange(input: unknown): { min: number; max: number } {
  const value = stateRecord(input);
  const min = stateNumber(value.min, 'scale range minimum');
  const max = stateNumber(value.max, 'scale range maximum', min);
  return { min, max };
}

function scaleState(input: unknown, legacy: boolean): PriceScaleState {
  const value = stateRecord(input);
  const field = (key: string, fallback: unknown): unknown => value[key] === undefined && legacy ? fallback : value[key];
  const mode = field('mode', 'linear');
  const inverted = field('inverted', false), autoScale = field('autoScale', true);
  if (!['linear', 'logarithmic', 'percentage', 'indexed-to-100'].includes(mode as string)
    || typeof inverted !== 'boolean' || typeof autoScale !== 'boolean') throw new Error('Invalid price scale mode or flags');
  const result: PriceScaleState = {
    marginTop: stateNumber(field('marginTop', 0.1), 'top scale margin'),
    marginBottom: stateNumber(field('marginBottom', 0.1), 'bottom scale margin'),
    minMove: stateNumber(field('minMove', 0), 'scale tick', 0), mode: mode as PriceScaleMode, inverted, autoScale,
  };
  if (value.minPrecision !== undefined) {
    result.minPrecision = stateNumber(value.minPrecision, 'scale precision', 0, 100);
    if (!Number.isInteger(result.minPrecision)) throw new Error('Scale precision must be an integer');
  }
  if (value.range !== undefined) result.range = stateRange(value.range);
  if (value.fixedRange !== undefined) result.fixedRange = value.fixedRange === null ? null : stateRange(value.fixedRange);
  if (value.indicatorRange !== undefined) {
    const owner = stateRecord(value.indicatorRange);
    if (typeof owner.instanceId !== 'string' || !owner.instanceId.trim() || typeof owner.manual !== 'boolean' || !result.fixedRange) {
      throw new Error('Invalid indicator range ownership');
    }
    result.indicatorRange = { instanceId: owner.instanceId, manual: owner.manual };
  }
  if (value.ratioLock !== undefined) {
    const lock = stateRecord(value.ratioLock);
    if (autoScale || !result.range) throw new Error('A scale ratio lock requires a manual range');
    result.ratioLock = { barSpacing: stateNumber(lock.barSpacing, 'ratio bar spacing', Number.MIN_VALUE),
      height: stateNumber(lock.height, 'ratio height', Number.MIN_VALUE) };
  }
  return result;
}

/** Validate and detach a pane snapshot before either a chart or workspace accepts it. */
export function parsePaneState(input: unknown, allowLegacyPartial = false): PaneState {
  const value = stateRecord(input);
  const result: PaneState = { weight: stateNumber(value.weight, 'pane weight', Number.MIN_VALUE),
    priceScale: scaleState(value.priceScale, allowLegacyPartial) };
  if (value.scales !== undefined) {
    const scales = stateRecord(value.scales);
    result.scales = {};
    for (const [id, state] of Object.entries(scales)) {
      if (id !== 'left' && id !== '' && !id.startsWith('overlay:')) throw new Error('Invalid secondary price scale id');
      result.scales[id as PriceScaleId] = scaleState(state, false);
    }
  }
  return result;
}

/** A series descriptor — enough to rebuild the shell, never the data. */
export interface SeriesState {
  type: string;
  style: SeriesStyle;
  paneIndex: number;
  priceScaleId: PriceScaleId;
}

export interface IndicatorState {
  indicatorId: string;
  /** Stable workspace identity. Omitted by legacy states and reusable templates. */
  instanceId?: string;
  /** Whole-study scale override. Omission retains the descriptor's plot assignments. */
  priceScaleId?: PriceScaleId;
  settings: IndicatorSettings;
  paneIndex: number;
  /** Omitted by older layouts, which restore the indicator as visible. */
  visible?: boolean;
}

export interface ChartState {
  version: number;
  /** Visible logical range at save time. */
  viewport?: { from: number; to: number };
  barSpacing?: number;
  grid?: { vertLines: boolean; horzLines: boolean };
  crosshairMode?: 'normal' | 'magnet';
  crosshairSnapToBar?: boolean;
  panes?: PaneState[];
  /** Informational: `restoreState` does not recreate these (it has no data). */
  series?: SeriesState[];
  indicators?: IndicatorState[];
  /**
   * Opaque slot the drawing tier fills. The base engine round-trips it
   * untouched, so an app that persists state keeps drawings for free once the
   * tier is loaded.
   */
  drawings?: unknown;
  alerts?: AlertsDocument;
}

/** What `restoreState` actually applied, so a caller can finish the job. */
export interface RestoreReport {
  /** True when the payload was a recognised, applicable state object. */
  applied: boolean;
  /** Series descriptors found in the state — the app rebuilds these itself. */
  series: SeriesState[];
  /** Indicator instances recreated. */
  indicators: number;
  /** Set when the payload was rejected. */
  reason?: string;
}
