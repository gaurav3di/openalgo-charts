/**
 * Indicator runtime (ARCHITECTURE.md §8). Turns an `IndicatorDescriptor` into
 * live chart objects: one series per plot, optional reference levels, an
 * optional fixed pane range — and recomputes them when the source data or the
 * settings change.
 *
 * It adds **no rendering code**. Every plot names a registered chart type, so
 * indicators draw through the same Family-A renderers as any other series.
 */
import type { Bar } from './bar';
import type { PriceFormat, SeriesApi } from './series';
import type { PriceLine } from '../primitives/price-line';
import type { PaneLegend, LegendValue } from '../primitives/pane-legend';
import type { SeriesMarkers } from '../primitives/markers';
import type { ChartTable } from '../primitives/table';
import type { IPrimitive } from '../primitives/primitive';
import type { IndicatorFillSpec, IndicatorPlot } from './indicator-registry';
import { IndicatorFill as IndicatorFillPrimitive } from '../primitives/indicator-fill';
import { IndicatorDrawings } from '../primitives/indicator-draws';
import { IndicatorBackground } from '../primitives/indicator-background';

import { isInvisible, withAlpha } from '../render/pill';
import { DEFAULT_TIMEZONE } from '../feed/time';
import { precisionForStep } from '../scale/ticks';
import {
  indicatorDefaults,
  indicatorStyleInputs,
  plotStyleKeys,
  type IndicatorBarsRequest,
  type ChartDataContext,
  type IndicatorDataChange,
  type IndicatorDataStatus,
  type IndicatorCalcContext,
  type IndicatorDescriptor,
  type IndicatorLevelContext,
  type IndicatorLineStyle,
  type IndicatorSettings,
  type IndicatorStore,
  type IndicatorValues,
} from './indicator-registry';

const num = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Defaults for the generated per-plot appearance settings. */
function styleDefaults(descriptor: IndicatorDescriptor): IndicatorSettings {
  const out: IndicatorSettings = {};
  for (const input of indicatorStyleInputs(descriptor)) out[input.key] = input.default;
  return out;
}

/**
 * Legend numbers: enough precision to be useful, never a 17-digit float.
 *
 * `tick` is the pane's price step when the pane quotes prices. Given one, the
 * value is formatted to exactly the precision that tick implies, which is the
 * same precision the axis beside it prints.
 *
 * Without it the magnitude ladder below applies, and that ladder is wrong for a
 * price: it rounds anything at or above 1000 to whole numbers, so a Supertrend
 * sitting at 1339.70 on a stock read "1340" in the legend while the axis two
 * inches away read 1339.70. The ladder is still right for the columns it was
 * written for, volume and open interest, where 12345678 has to compact to
 * 12.35M and the trailing paise are noise.
 */
function formatValue(v: number, tick?: number): string {
  if (tick !== undefined && tick > 0) return v.toFixed(precisionForStep(tick));
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

/** The slice of the chart the runtime needs. Keeps this module testable alone. */
export interface IndicatorHost {
  /** Forget a disposed instance, including disposal through its public handle. */
  indicatorRemoved?(instanceId: string): void;
  /** Optional instrument identity and source-range notifications. */
  dataContext?(): Readonly<ChartDataContext> | undefined;
  subscribeDataChanges?(listener: (change: IndicatorDataChange) => void): () => void;
  /** Add the pane-legend row (name + inline up/down/hide/maximize/close). */
  addIndicatorLegend(opts: {
    id: string; title: string; params: string; color?: string; row: number; paneIndex: number;
    /** The descriptor's `hasSource`, so the row can offer a source button. */
    hasSource?: boolean;
  }): PaneLegend;
  removeIndicatorLegend(legend: PaneLegend): void;
  /** How many legends already sit on this pane, so rows stack. */
  legendRowsOn(paneIndex: number): number;
  /** The instrument's own series, for a descriptor anchoring marks to price. */
  primarySeries?(): SeriesApi | null;
  addIndicatorSeries(
    type: string,
    paneIndex: number,
    style: Record<string, unknown> | undefined,
    priceScaleId: string | undefined,
    /** Axis/crosshair formatting for the scale this plot maps to. */
    priceFormat?: PriceFormat,
  ): SeriesApi;
  /**
   * Add a reference level. One options object rather than seven positional
   * arguments: the list grew a width and a dash style in 1.7.1, and a call site
   * of seven bare values is where the next one gets passed in the wrong slot.
   */
  addIndicatorLevel(
    level: {
      price: number;
      color: string;
      /** Kept for hosts predating `lineStyle`; always `lineStyle === 'dashed'`. */
      dashed: boolean;
      lineWidth: number;
      lineStyle: IndicatorLineStyle;
      label: string;
      id: string;
    },
    paneIndex: number,
  ): PriceLine;
  removeIndicatorLevel(line: PriceLine): void;
  /** Attach a band drawn behind the plots (an Ichimoku cloud). */
  addIndicatorFill(fill: IndicatorFillPrimitive, paneIndex: number): void;
  removeIndicatorFill(fill: IndicatorFillPrimitive): void;
  /**
   * Detach a signal-marker layer. There is no matching `add`: the layer comes
   * from `series.createMarkers()` on a plot's own series, so it already lands in
   * the right pane. Removing a series does not remove its primitives, hence this.
   */
  removeIndicatorMarkers(markers: SeriesMarkers): void;
  /** Attach a corner-pinned summary grid to a pane, and detach it again. */
  addIndicatorTable(paneIndex: number): ChartTable;
  removeIndicatorTable(table: ChartTable): void;
  /**
   * Attach an arbitrary primitive to a pane, and detach it again. Carries both
   * the descriptor's drawing layer and whatever a Tier-2 `attach` lifecycle
   * wants to paint, so those two do not need a host method each.
   *
   * Optional, like `timezone`, so a host predating it still satisfies this
   * interface: an indicator that draws simply draws nothing there.
   */
  addIndicatorPrimitive?(primitive: IPrimitive, paneIndex: number): void;
  removeIndicatorPrimitive?(primitive: IPrimitive): void;
  /**
   * Recompute whatever the host has marked stale, before a caller reads a value.
   *
   * Optional, like `timezone`, so a host predating it still satisfies this
   * interface: one that recomputes eagerly has nothing to flush.
   */
  flushIndicators?(): void;
  /** Restore the host's study stack after settings replace series or attached visuals. */
  resourcesChanged?(): void;
  /** Bars of the primary price series — the calculation input. */
  sourceBars(): readonly Bar[];
  /** Selected candle after native or linked hover; absent means latest. */
  legendIndex?(): number | undefined;
  /** Index of a fresh pane for an indicator that wants its own. */
  nextPaneIndex(): number;
  /**
   * The chart's configured IANA zone. Optional so a host predating the option
   * still satisfies this interface; absent means the shipped default.
   *
   * A descriptor is handed bars and settings and never the chart, so this is
   * how the calendar an anchor resets on (a VWAP session, a seasonality month)
   * reaches the calculation. See `IndicatorInstance._descriptorSettings`.
   */
  timezone?(): string;
  /**
   * The instrument and timeframe on screen, when the host knows them. The
   * host can supply an explicit `dataContext` instead. Without either hook,
   * a descriptor sees `undefined` rather than a guessed identity.
   */
  symbol?(): string | undefined;
  interval?(): string | undefined;
  /** Chart wall clock in UTC seconds. Absent means the system clock. */
  now?(): number;
  /**
   * Publish an indicator's per-bar colours onto the **primary price series**,
   * or withdraw them with `null`. `owner` is the instance id: a host holds one
   * overlay at a time and only lets its current owner withdraw it, so a second
   * publisher taking over does not get cleared by the first one's teardown.
   *
   * Optional, like `timezone`: a host that does not implement it simply gives a
   * `barColors` descriptor nowhere to publish, and the indicator's own plots are
   * unaffected.
   */
  setBarColors?(colors: readonly (string | null)[] | null, owner: string): void;
  /** Emit on the chart's event bus (indicator alerts, and `attach`'s own events). */
  emit?(event: string, payload: unknown): void;
  /**
   * Bars of another instrument or interval, from wherever the host keeps its
   * history. Optional: without it the attach context's `requestBars` rejects,
   * which a study reads as "not available on this chart".
   */
  requestBars?(request: IndicatorBarsRequest): Promise<readonly Bar[]>;
  /**
   * Tick size of the named pane's price scale, or undefined when none is set.
   * Optional so a host predating it still satisfies this interface.
   *
   * Per pane, and the panes genuinely differ: a pane that does not quote the
   * instrument has no tick to report. Pane 0 is the price pane, so it is the
   * one to ask for the instrument's own step.
   */
  tickSize?(paneIndex: number): number | undefined;
  /**
   * Write a number the way the price axis of that pane writes it.
   *
   * The legend sits inches from the axis and names the same quantity, so the
   * two disagreeing is the reading a user has to reconcile themselves. Deriving
   * the format here from a tick got that wrong twice over: a study pane carries
   * no tick at all, so a percentage read `0.618` beside an axis saying `0.62`,
   * and a price pane's tick alone misses the precision floor and the host's own
   * formatter, so a volume study read seven digits where its axis said `1.20M`.
   *
   * Asking the scale removes the second opinion. Optional so a host driving
   * this module alone still works, falling back to the magnitude ladder.
   */
  formatPrice?(paneIndex: number, value: number): string | undefined;
  /** Pin a pane's price scale to a fixed range, or release it with `null`. */
  setPaneRange(paneIndex: number, range: { min: number; max: number } | null): void;
}

/** Public handle returned by `chart.addIndicator(...)`. */
export interface IndicatorApi {
  /** External data state, or null for a study without a managed lifecycle. */
  dataStatus(): Readonly<IndicatorDataStatus> | null;
  /** Observe changes; immediately receives the current managed status, if any. */
  subscribeDataStatus(listener: (status: Readonly<IndicatorDataStatus>) => void): () => void;
  /** Retry external history when the descriptor supplies a retry action. */
  retryData(): void;
  /** Unique instance id (several instances of one indicator can coexist). */
  readonly id: string;
  /** The descriptor id, e.g. `'macd'`. */
  readonly indicatorId: string;
  /** Display name. */
  readonly name: string;
  /** Pane the indicator drew into. */
  readonly paneIndex: number;
  /** Current settings (a copy). */
  settings(): IndicatorSettings;
  /** Merge a settings patch, recompute, and restyle. */
  setSettings(patch: Readonly<IndicatorSettings>): void;
  /** The series backing one plot key, for direct styling. */
  series(plotKey: string): SeriesApi | undefined;
  /** Latest computed values (a reference — do not mutate). */
  values(): IndicatorValues;
  /** Whether the plots are drawn (the legend's eye toggle). */
  visible(): boolean;
  /** Show or hide every plot without removing the instance. */
  setVisible(on: boolean): void;
  /** This indicator's legend row, or null if it has none. */
  legend(): PaneLegend | null;
  /** Refresh the legend readings for a bar index; omit for the latest bar. */
  updateLegendValues(index?: number): void;
  /** Remove every series, level, and legend row this indicator created. */
  remove(): void;
}

let nextInstance = 1;

export class IndicatorInstance implements IndicatorApi {
  public readonly id: string;
  public readonly indicatorId: string;
  public readonly name: string;
  /** Mutable: the chart re-indexes this when panes are moved or removed. */
  public paneIndex: number;

  private readonly _host: IndicatorHost;
  private readonly _d: IndicatorDescriptor;
  private readonly _ownPane: boolean;
  private _settings: IndicatorSettings;
  /** Memo for `_descriptorSettings`, keyed on the zone and the settings identity. */
  private _zoned: { zone: string; base: IndicatorSettings; merged: IndicatorSettings } | null = null;
  private readonly _series = new Map<string, SeriesApi>();
  /** The chart type each plot is currently drawn as (settings can override). */
  private readonly _plotTypes = new Map<string, string>();
  /** One band per declared fill, in descriptor order. */
  private readonly _fills: IndicatorFillPrimitive[] = [];
  private _levels: PriceLine[] = [];
  /** Signature of the level list the price lines were built from. */
  private _levelSig = '';
  private _values: IndicatorValues = {};
  private _barCount = 0;
  /**
   * First and last bar times behind `_values`. `_barCount` alone cannot tell a
   * live tick from a symbol change or a page of history, and both of those can
   * land on a matching count. See `recompute`.
   */
  private _firstTime = 0;
  private _lastTime = 0;
  private _removed = false;
  private readonly _store: IndicatorStore = {};
  private readonly _attachedPrimitives = new Set<IPrimitive>();
  private _detach: (() => void) | null = null;
  private readonly _lifetime = new AbortController();
  private _dataStatus: Readonly<IndicatorDataStatus> | null = null;
  private _dataRetry: (() => void) | null = null;
  private readonly _dataListeners = new Set<(status: Readonly<IndicatorDataStatus>) => void>();
  private _legend: PaneLegend | null = null;
  private _markers: SeriesMarkers | null = null;
  private _markerSeries: SeriesApi | undefined;
  private _table: ChartTable | null = null;
  private _draws: IndicatorDrawings | null = null;
  private _background: IndicatorBackground | null = null;
  /**
   * Time of the newest bar the alerts have already judged. Bars at or before it
   * are history as far as this instance is concerned, so a full recompute (a
   * settings change, a page of older bars) re-fires nothing.
   */
  private _alertTime = 0;
  /** Set once a tail-only change lands, which is what a live feed looks like. */
  private _live = false;
  private _visible = true;
  /** Set once the constructor's own recompute has passed; see `recompute`. */
  private _constructed = false;
  /** Whether the status currently published is a recompute failure of ours. */
  private _calcFailed = false;

  public constructor(
    host: IndicatorHost,
    descriptor: IndicatorDescriptor,
    settings: Readonly<IndicatorSettings> = {},
    paneIndex?: number,
    instanceId?: string,
    reservedIds?: ReadonlySet<string>,
  ) {
    this._host = host;
    this._d = descriptor;
    this.indicatorId = descriptor.id;
    this.name = descriptor.name;
    let id = instanceId;
    if (id === undefined) do { id = `${descriptor.id}-${nextInstance++}`; } while (reservedIds?.has(id));
    this.id = id;
    // Declared inputs plus the generated per-plot appearance settings, so every
    // indicator supports colour / opacity / thickness / line style with no
    // per-descriptor boilerplate.
    this._settings = {
      ...indicatorDefaults(descriptor),
      ...styleDefaults(descriptor),
      ...settings,
    };

    if (paneIndex !== undefined) {
      this.paneIndex = paneIndex;
      this._ownPane = false;
    } else if (descriptor.placement === 'onchart') {
      this.paneIndex = 0;
      this._ownPane = false;
    } else {
      this.paneIndex = host.nextPaneIndex();
      this._ownPane = true;
    }

    for (const plot of descriptor.plots) {
      const type = this._plotType(plot);
      this._plotTypes.set(plot.key, type);
      this._series.set(
        plot.key,
        host.addIndicatorSeries(type, this._plotPane(plot), this._plotStyle(plot), plot.priceScaleId, plot.priceFormat),
      );
    }

    for (const fill of descriptor.fills ?? []) {
      const band = new IndicatorFillPrimitive({
        colorUp: this._fillColor(fill, true),
        colorDown: this._fillColor(fill, false),
        opacity: fill.opacity ?? 0.12,
      });
      this._fills.push(band);
      // A band may follow its plots onto the price pane; see `IndicatorFillSpec.overlay`.
      host.addIndicatorFill(band, fill.overlay === true ? 0 : this.paneIndex);
    }

    this._legend = host.addIndicatorLegend({
      id: `indicator:${this.id}`,
      title: descriptor.name,
      params: this._paramSummary(),
      color: this._legendColor(),
      row: host.legendRowsOn(this.paneIndex),
      paneIndex: this.paneIndex,
      hasSource: descriptor.hasSource === true,
    });

    this._applyRange();
    // Levels are applied inside `recompute`, so a data-derived one is built
    // from values that exist rather than from the empty set. This first pass
    // is deliberately unguarded: a descriptor that cannot compute at all is
    // refused by `addIndicator`, not added as a permanently empty pane.
    this.recompute();
    this._constructed = true;
    this._attach();
  }

  /**
   * Which pane a plot's series belongs on. Normally the indicator's own, but a
   * plot may force itself onto the price pane (`overlay`), so one descriptor can
   * put its study in a pane and its band on the candles.
   */
  private _plotPane(plot: IndicatorPlot): number {
    return plot.overlay === true ? 0 : this.paneIndex;
  }

  /**
   * The numeric/select inputs as a compact string (`14 close`), the way a
   * charting legend abbreviates an indicator's configuration. Colors are
   * excluded — the swatch already carries that. Booleans are excluded for the
   * same reason in reverse: a bare `true true true` names nothing, and what a
   * visibility toggle did is already visible on the chart.
   */
  private _paramSummary(): string {
    const out: string[] = [];
    for (const input of this._d.inputs) {
      if (input.type === 'color' || input.type === 'boolean') continue;
      const v = this._settings[input.key];
      if (v === undefined || v === null || v === '') continue;
      out.push(String(v));
    }
    return out.join(' ');
  }

  /** First settings-driven plot color, for the legend swatch. */
  private _legendColor(): string | undefined {
    for (const plot of this._d.plots) {
      const key = plot.colorKey;
      if (key !== undefined && typeof this._settings[key] === 'string') return this._settings[key] as string;
      if (typeof plot.style?.color === 'string') return plot.style.color;
    }
    return undefined;
  }

  /** Whether the indicator's plots are drawn. */
  public visible(): boolean {
    return this._visible;
  }

  /** Show or hide every plot without removing the instance (the eye button). */
  public setVisible(on: boolean): void {
    if (this._removed || on === this._visible) return;
    this._visible = on;
    for (const plot of this._d.plots) this._series.get(plot.key)?.applyOptions({ visible: on && plot.style?.visible !== false });
    for (const band of this._fills) band.setVisible(on);
    // Markers are a separate primitive, so hiding the plots does not hide them;
    // re-running the sync clears the layer (or repopulates it) explicitly.
    const bars = this._host.sourceBars();
    this._applyLevels(bars, this._descriptorSettings());
    this._syncMarkers(bars);
    this._syncTable(bars);
    this._syncBarColors(bars);
    this._draws?.setVisible(on);
    this._background?.setVisible(on);
    this._legend?.setOptions({ hidden: !on });
    this._host.emit?.('objects:change', {});
  }

  /** The chart calls this when panes are reordered or one is removed. */
  public shiftPane(delta: number): void {
    this.paneIndex += delta;
  }

  /** Owned render resources, with explicit price overlays left on pane zero. */
  public renderResources(): { series: { api: SeriesApi; overlay: boolean }[]; primitives: { primitive: IPrimitive; overlay: boolean }[] } {
    const series = this._d.plots.flatMap(plot => {
      const api = this._series.get(plot.key);
      return api ? [{ api, overlay: plot.overlay === true }] : [];
    });
    const primitives = this._fills.map((primitive, index) => ({ primitive: primitive as IPrimitive, overlay: this._d.fills?.[index].overlay === true }));
    for (const primitive of [this._legend, ...this._levels, this._markers, this._table, this._draws, this._background, ...this._attachedPrimitives]) {
      if (primitive !== null) primitives.push({ primitive, overlay: primitive === this._markers && (this._markerSeries === this._host.primarySeries?.() || series.some(item => item.api === this._markerSeries && item.overlay)) });
    }
    return { series, primitives };
  }

  /** Move the existing instance without rerunning its external attach lifecycle. */
  public relocate(paneIndex: number): void {
    if (this._ownPane) this._host.setPaneRange(this.paneIndex, null);
    this.paneIndex = paneIndex;
    this._applyRange();
    this._syncMarkers(this._host.sourceBars());
  }

  /** Republish candle colors after a change in instance stacking order. */
  public refreshBarColors(): void { this._syncBarColors(this._host.sourceBars()); }

  /** The legend row, for the host to add pane-level actions to the first one. */
  public legend(): PaneLegend | null {
    return this._legend;
  }

  /**
   * Show one reading per plot on the legend row, each in its plot's own color —
   * a multi-plot source (an MA ribbon, MACD) is unreadable as a single number.
   * `index` is the crosshair's bar; omit it for the latest bar.
   */
  public updateLegendValues(index?: number): void {
    if (this._legend === null) return;
    const n = this._barCount;
    const i = index === undefined || index < 0 || index >= n ? n - 1 : index;
    if (i < 0) { this._legend.setValues([]); return; }
    const out: LegendValue[] = [];
    for (const plot of this._d.plots) {
      // A bar-shaped plot's `key` names no column of its own, so the legend
      // reads the close, which is the number a candle legend shows anyway.
      // A shifted plot paints value `i - offset` under bar `i`, and the legend
      // reads what is drawn under the cursor, not what was computed for it.
      const v = this._values[plot.ohlc?.close ?? plot.key]?.[i - (plot.offset ?? 0)];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      // The pane this plot draws in, so a plot on its own pane is written the
      // way that pane's axis writes it and not the price pane's.
      const pane = this._plotPane(plot);
      // A plot drawn in a fully transparent colour is on the chart only to be
      // measured against: the invisible mid-body line a marker anchors to, a
      // column a band is filled from. It draws nothing, so it has no number to
      // read, and reading one anyway left a blank the width of a price sitting
      // between the parameters and the first real value. That reads as a
      // broken legend, because from the outside it is one.
      const color = this._plotColor(plot);
      if (color !== undefined && isInvisible(color)) continue;
      const text = this._host.formatPrice?.(pane, v)
        ?? formatValue(v, this._host.tickSize?.(pane));
      out.push({ text, color });
    }
    this._legend.setValues(out);
  }

  /** A band's colour: its settings key if it has one, else the declared value. */
  private _fillColor(fill: IndicatorFillSpec, up: boolean): string {
    const key = up ? fill.colorUpKey : fill.colorDownKey;
    const fromSettings = key !== undefined ? this._settings[key] : undefined;
    if (typeof fromSettings === 'string') return fromSettings;
    const declared = up ? fill.colorUp : fill.colorDown;
    return declared ?? (up ? '#26a69a' : '#ef5350');
  }

  /** Feed each band the two plots it spans, on the shared logical index. */
  private _syncFills(): void {
    const fills = this._d.fills ?? [];
    for (let i = 0; i < fills.length; i++) {
      const band = this._fills[i];
      if (band === undefined) continue;
      const spec = fills[i];
      const a = this._values[spec.between[0]];
      const b = this._values[spec.between[1]];
      band.setOptions({
        colorUp: this._fillColor(spec, true),
        colorDown: this._fillColor(spec, false),
        opacity: spec.opacity ?? 0.12,
      });
      if (a === undefined || b === undefined) { band.setPoints([]); continue; }
      // The band follows its first plot's shift, so a displaced cloud is
      // shaded where its edges are painted rather than where they were computed.
      const shift = this._d.plots.find((p) => p.key === spec.between[0])?.offset ?? 0;
      const pts = [];
      for (let j = 0; j < this._barCount; j++) {
        pts.push({ index: j + shift, a: a[j] ?? null, b: b[j] ?? null });
      }
      band.setPoints(pts);
    }
  }

  /**
   * Refresh the descriptor's signal markers. The layer is created lazily on the
   * first plot's series — so it shares the indicator's pane and price scale —
   * and is only created once the descriptor actually returns a marker, which
   * keeps the common no-marker indicator free of an extra primitive.
   */
  private _syncMarkers(bars: readonly Bar[]): void {
    if (this._d.markers === undefined) return;
    const markers = this._visible
      ? this._d.markers({ bars, values: this._values, settings: this._descriptorSettings() })
      : [];
    const primary = this._host.primarySeries?.() ?? undefined;
    const first = (this._d.markerAnchor === 'price' && this.paneIndex === 0 ? primary : undefined)
      ?? this._series.get(this._d.plots[0]?.key ?? '');
    if (this._markers !== null && first !== this._markerSeries) {
      this._host.removeIndicatorMarkers(this._markers);
      this._markers = null;
    }
    if (this._markers === null) {
      if (markers.length === 0) return;
      if (first === undefined) return;
      this._markerSeries = first;
      // Only substitute instrument bars when both series share price units.
      // Resolve scales lazily so moving an axis keeps the same guarantee.
      this._markers = first.createMarkers(() => {
        const current = this._host.primarySeries?.();
        return this.paneIndex === 0 && current != null && first.priceScale() === current.priceScale()
          ? this._host.sourceBars() : [];
      });
    }
    this._markers.setMarkers(markers);
  }

  /**
   * Refresh the descriptor's summary grid, created lazily on first use so an
   * indicator without the hook never costs an extra primitive.
   */
  private _syncTable(bars: readonly Bar[]): void {
    if (this._d.table === undefined) return;
    const spec = this._visible
      ? this._d.table({ bars, values: this._values, settings: this._descriptorSettings() })
      : null;
    const rows = spec?.rows ?? [];
    if (this._table === null) {
      if (rows.length === 0) return;
      this._table = this._host.addIndicatorTable(this.paneIndex);
    }
    if (spec?.options !== undefined) this._table.setOptions(spec.options);
    this._table.setRows(rows);
  }

  /**
   * Refresh the descriptor's drawings. Rebuilt wholesale on every recompute,
   * the way markers are: a shape is derived geometry, so diffing it against the
   * previous frame would cost more than recreating the list.
   */
  private _syncDraws(bars: readonly Bar[]): void {
    if (this._d.draws === undefined) return;
    const items = this._d.draws({ bars, values: this._values, settings: this._descriptorSettings() });
    if (this._draws === null) {
      if (items.length === 0 || this._host.addIndicatorPrimitive === undefined) return;
      this._draws = new IndicatorDrawings();
      this._draws.setVisible(this._visible);
      this._host.addIndicatorPrimitive(this._draws, this.paneIndex);
    }
    this._draws.setItems(items);
  }

  /**
   * Refresh the pane's per-bar shading, created lazily on first use the way the
   * drawing layer is. Hidden rather than detached when the indicator is hidden,
   * because a regime background is the cheapest layer here to keep around.
   */
  private _syncBackground(bars: readonly Bar[]): void {
    if (this._d.background === undefined) return;
    const colors = this._d.background({ bars, values: this._values, settings: this._descriptorSettings() });
    if (this._background === null) {
      if (colors.length === 0 || this._host.addIndicatorPrimitive === undefined) return;
      this._background = new IndicatorBackground();
      this._background.setVisible(this._visible);
      this._host.addIndicatorPrimitive(this._background, this.paneIndex);
    }
    this._background.setColors(colors, bars);
  }

  /**
   * Publish the descriptor's price-bar colours, or withdraw them while hidden.
   * The host owns the arbitration between two publishers (see `setBarColors`);
   * all this side does is state what this instance currently wants.
   */
  private _syncBarColors(bars: readonly Bar[]): void {
    if (this._d.barColors === undefined) return;
    const colors = this._visible
      ? this._d.barColors({ bars, values: this._values, settings: this._descriptorSettings() })
      : null;
    this._host.setBarColors?.(colors, this.id);
  }

  /**
   * Fire the descriptor's alerts for bars that have appeared since the last
   * pass. The watermark is a bar **time**, not a count: a page of history
   * arriving at the left edge changes every index and would otherwise re-fire
   * the whole chart.
   *
   * Only a tail-only change can fire, which is the same gate `calcTail` uses and
   * for the same reason: any other change replaced history, and an indicator
   * dropped onto a loaded chart (or moved to another symbol) must not announce
   * every crossover of the last two years at once. Such a pass reseeds silently.
   */
  private _syncAlerts(
    bars: readonly Bar[],
    settings: Readonly<IndicatorSettings>,
    tailOnly: boolean,
  ): void {
    const specs = this._d.alerts;
    const n = bars.length;
    if (specs === undefined || n === 0) return;
    const seen = this._alertTime;
    this._alertTime = bars[n - 1].time;
    if (!tailOnly) return;
    let from = n;
    while (from > 0 && bars[from - 1].time > seen) from--;
    for (let i = from; i < n; i++) {
      for (const spec of specs) {
        const ctx = { bars, values: this._values, settings, index: i };
        if (!spec.when(ctx)) continue;
        this._host.emit?.('indicator:alert', {
          indicatorId: this.indicatorId,
          instanceId: this.id,
          alertId: spec.id,
          title: spec.title,
          message: typeof spec.message === 'function' ? spec.message(ctx) : (spec.message ?? spec.title),
          time: bars[i].time,
          index: i,
        });
      }
    }
  }

  /**
   * The optional fourth argument to `calc`, rebuilt per recompute because
   * `barState` is the whole reason it exists and it moves every tick.
   *
   * `isConfirmed` is inferred from the last bar gap against the chart clock,
   * which is the only interval signal the engine has: it is handed bars and
   * never a timeframe. A session break or a holiday widens that gap, so read it
   * as "this bar's own span has elapsed", not as an exchange close.
   */
  private _calcContext(bars: readonly Bar[], appended: boolean): IndicatorCalcContext {
    const n = bars.length;
    const now = (): number => this._host.now?.() ?? Date.now() / 1000;
    const step = n > 1 ? bars[n - 1].time - bars[n - 2].time : 0;
    return {
      barState: {
        isNew: appended,
        isConfirmed: n === 0 || step <= 0 || now() >= bars[n - 1].time + step,
        isRealtime: this._live,
        lastIndex: n - 1,
      },
      symbol: this._host.symbol?.(),
      interval: this._host.interval?.(),
      timezone: this._host.timezone?.() ?? DEFAULT_TIMEZONE,
      now,
      // Pane 0's, not this indicator's own pane: `calc` runs on the
      // instrument's bars, so the step it sizes a range in is the instrument's,
      // whatever units the pane it draws in happens to read. An oscillator's
      // pane carries no tick at all (see `Chart._scalePatchFor`), so asking it
      // would answer "nobody said" for every study off the price pane.
      // 0 is the scale's "infer from the visible range" sentinel, not a tick.
      tickSize: this._host.tickSize?.(0) || undefined,
    };
  }

  /** The chart type to draw a plot as: the settings override, else declared. */
  private _plotType(plot: IndicatorPlot): string {
    const v = this._settings[plotStyleKeys(plot).type];
    return typeof v === 'string' && v !== '' ? v : plot.type;
  }

  private _plotColor(plot: IndicatorPlot): string | undefined {
    const v = this._settings[plotStyleKeys(plot).color];
    if (typeof v === 'string') return v;
    return typeof plot.style?.color === 'string' ? plot.style.color : undefined;
  }

  /**
   * The series style for a plot: its declared defaults, then the legacy
   * `colorKey`, then the generated appearance settings. Opacity folds into the
   * colour as an alpha, since a canvas stroke has no separate opacity channel.
   */
  private _plotStyle(plot: IndicatorPlot): Record<string, unknown> {
    const k = plotStyleKeys(plot);
    const style: Record<string, unknown> = {
      ...(plot.style ?? {}), title: plot.title, visible: this._visible && plot.style?.visible !== false,
    };
    const color = this._plotColor(plot);
    const opacity = num(this._settings[k.opacity], 100);
    if (color !== undefined) style.color = opacity >= 100 ? color : withAlpha(color, opacity / 100);
    const width = this._settings[k.width];
    if (typeof width === 'number' && width > 0) style.lineWidth = width;
    const lineStyle = this._settings[k.lineStyle];
    if (typeof lineStyle === 'string') style.lineStyle = lineStyle;
    if (plot.offset !== undefined && plot.offset !== 0) style.barOffset = plot.offset;
    return style;
  }

  /**
   * Run the descriptor's optional lifecycle (Tier-2 fetch / subscribe). Re-run
   * on every settings change so an indicator whose data depends on a setting
   * can reload; `_store` persists across the cycle, so a descriptor that caches
   * there can no-op when nothing data-affecting actually changed.
   */
  private _attach(): void {
    this._dataRetry = null;
    const detach = this._d.attach?.({
      dataContext: () => this._host.dataContext?.(),
      subscribeDataChanges: (listener) => this._host.subscribeDataChanges?.(listener) ?? (() => {}),
      signal: this._lifetime.signal,
      setDataStatus: (status) => this._publishStatus(status),
      setDataRetry: (retry) => { if (!this._removed) this._dataRetry = retry; },
      requestBars: (request) => {
        const provider = this._host.requestBars;
        if (provider === undefined) {
          return Promise.reject(new Error(
            'openalgo-charts: this chart has no bars provider; call chart.setBarsProvider(...) to serve other instruments',
          ));
        }
        // The instance lifetime bounds every request, so a study removed while
        // its benchmark is loading is not answered after it is gone.
        return provider({ ...request, signal: request.signal ?? this._lifetime.signal });
      },
      settings: () => this._descriptorSettings(),
      bars: () => this._host.sourceBars(),
      requestRecompute: () => {
        if (this._removed) return;
        this._barCount = 0; // external data invalidates any calcTail state
        this.recompute();
      },
      store: this._store,
      symbol: () => this._host.symbol?.(),
      interval: () => this._host.interval?.(),
      timezone: () => this._host.timezone?.() ?? DEFAULT_TIMEZONE,
      now: () => this._host.now?.() ?? Date.now() / 1000,
      paneIndex: () => this.paneIndex,
      addPrimitive: (p: IPrimitive) => { this._attachedPrimitives.add(p); this._host.addIndicatorPrimitive?.(p, this.paneIndex); },
      removePrimitive: (p: IPrimitive) => { this._attachedPrimitives.delete(p); this._host.removeIndicatorPrimitive?.(p); },
      emit: (event: string, payload: unknown) => { this._host.emit?.(event, payload); },
    });
    this._detach = typeof detach === 'function' ? detach : null;
  }

  /**
   * Publish the instance's data status once per change. Shared by the attach
   * context's `setDataStatus` and by the recompute guard, so a study's own
   * lifecycle and a failed calculation report through one channel.
   */
  private _publishStatus(status: IndicatorDataStatus): void {
    if (this._removed) return;
    const previous = this._dataStatus;
    if (previous?.state === status.state &&
      (status.state !== 'error' || (previous.state === 'error' && previous.error === status.error))) return;
    this._dataStatus = Object.freeze({ ...status });
    for (const listener of this._dataListeners) listener(this._dataStatus);
    this._host.emit?.('indicator:data-status', {
      id: this.id, indicatorId: this.indicatorId, status: this._dataStatus,
    });
  }

  public dataStatus(): Readonly<IndicatorDataStatus> | null { return this._dataStatus; }

  public subscribeDataStatus(listener: (status: Readonly<IndicatorDataStatus>) => void): () => void {
    if (this._removed) return () => {};
    this._dataListeners.add(listener);
    if (this._dataStatus !== null) listener(this._dataStatus);
    return () => { this._dataListeners.delete(listener); };
  }

  public retryData(): void { if (!this._removed) this._dataRetry?.(); }

  public settings(): IndicatorSettings {
    return { ...this._settings };
  }

  /**
   * Settings as a *descriptor* sees them: the chart's zone rides along under
   * the reserved `timezone` key, because a `calc` is handed settings and never
   * the chart.
   *
   * It is deliberately not folded into `_settings`. That object is the user's
   * own values, it is what `settings()` returns and what `getState()` persists,
   * and baking the zone into it would mean a layout saved on a New York chart
   * kept computing on New York after being restored onto an IST one, silently
   * out of step with the axis beside it.
   *
   * The default zone returns `_settings` untouched, so every existing caller
   * allocates nothing and computes exactly what it computed before.
   */
  private _descriptorSettings(): Readonly<IndicatorSettings> {
    const zone = this._host.timezone?.() ?? DEFAULT_TIMEZONE;
    if (zone === DEFAULT_TIMEZONE) return this._settings;
    const cached = this._zoned;
    // `_settings` is replaced wholesale by `setSettings`, so identity is a
    // sufficient staleness check and costs one compare per recompute.
    if (cached !== null && cached.zone === zone && cached.base === this._settings) return cached.merged;
    const merged = { ...this._settings, timezone: zone };
    this._zoned = { zone, base: this._settings, merged };
    return merged;
  }

  public series(plotKey: string): SeriesApi | undefined {
    return this._series.get(plotKey);
  }

  public values(): IndicatorValues {
    // The host defers recompute to the frame, so a caller that updates a bar and
    // reads the value back in the same turn would otherwise get the previous
    // tick's numbers. Flushing here keeps the read synchronous without putting
    // the maths back on the data-update path.
    this._host.flushIndicators?.();
    return this._values;
  }

  public setSettings(patch: Readonly<IndicatorSettings>): void {
    if (this._removed) return;
    this._settings = { ...this._settings, ...patch };
    // Restyle before recomputing — appearance is independent of the maths, so a
    // colour or thickness change must not wait on a full recalculation.
    for (const plot of this._d.plots) {
      // A plot's chart type belongs to the series, not its style bag, so
      // switching it means building a new series rather than restyling.
      const wanted = this._plotType(plot);
      if (wanted !== this._plotTypes.get(plot.key)) {
        this._series.get(plot.key)?.remove();
        this._series.set(
          plot.key,
          this._host.addIndicatorSeries(wanted, this._plotPane(plot), this._plotStyle(plot), plot.priceScaleId, plot.priceFormat),
        );
        this._plotTypes.set(plot.key, wanted);
        continue;
      }
      this._series.get(plot.key)?.applyOptions(this._plotStyle(plot) as never);
    }
    this._legend?.setOptions({ params: this._paramSummary(), color: this._legendColor() });
    this._applyRange();
    this._values = {};
    this._barCount = 0; // force a full recompute; settings invalidate any tail state
    this.recompute();
    this._detach?.();
    this._attach();
    this._host.resourcesChanged?.();
    this._host.emit?.('objects:change', {});
  }

  /**
   * Recompute from the host's source bars. Uses the descriptor's `calcTail`
   * when only the tail moved (a live tick) and it declares one; otherwise a
   * full `calc`.
   */
  public recompute(): void {
    if (this._removed) return;
    // The constructor's pass throws through: see the note there.
    if (!this._constructed) { this._recompute(); return; }
    try {
      this._recompute();
    } catch (error) {
      // One study's bad input must not stall the frame for every other one, and
      // a study that silently stops drawing tells the user nothing. So the
      // failure goes where a Tier-2 fetch failure already goes, the previous
      // plots stay up, and the next recompute that succeeds clears it.
      this._calcFailed = true;
      this._publishStatus({ state: 'error', error });
      return;
    }
    if (this._calcFailed) {
      this._calcFailed = false;
      this._publishStatus({ state: 'ready' });
    }
  }

  private _recompute(): void {
    const bars = this._host.sourceBars();
    const n = bars.length;
    // Resolved once: the zone is fixed for the frame, and calc, calcTail and
    // every colorBy below must be told the same calendar.
    const settings = this._descriptorSettings();

    let values: IndicatorValues | null = null;
    // The tail path is only valid when the previous result still describes every
    // bar before the tail. A bar count of `n` or `n + 1` does not say that: a
    // page of history arriving at the left edge, or a symbol change, can land on
    // a matching count and would then splice new values onto a history that no
    // longer exists, leaving the plot silently wrong until the next full calc.
    // So gate it on the times instead: the first bar must be unchanged, and the
    // last bar must either be the same one (replaced in place) or sit directly
    // after it (appended). Reading the bucket off `bars[n - 2]` avoids guessing
    // the interval, which a session gap or a holiday makes unguessable anyway.
    // The same signal answers `barState.isNew`: an append is exactly the branch
    // that is not a replacement of the last bar, and inventing a second way to
    // decide that would be a second thing to keep in step with this one.
    const appended = this._barCount > 0 && n === this._barCount + 1 &&
      bars[n - 2].time === this._lastTime && bars[0].time === this._firstTime;
    const tailOnly = n > 0 && this._barCount > 0 && bars[0].time === this._firstTime &&
      ((n === this._barCount && bars[n - 1].time === this._lastTime) || appended);
    // A tail-only change is what a live feed looks like from here; a history
    // load replaces everything and never lands on this branch.
    if (tailOnly) this._live = true;
    const ctx = this._calcContext(bars, appended);
    if (tailOnly && this._d.calcTail !== undefined) {
      const from = this._barCount - 1; // the previously-last bar may have been replaced
      const tail = this._d.calcTail(bars, settings, from, this._values, this._store, ctx);
      if (tail !== null) values = spliceTail(this._values, tail, from, n);
    }
    if (values === null) values = this._d.calc(bars, settings, this._store, ctx);

    this._values = values;
    this._barCount = n;
    this._firstTime = n > 0 ? bars[0].time : 0;
    this._lastTime = n > 0 ? bars[n - 1].time : 0;

    for (const plot of this._d.plots) {
      const series = this._series.get(plot.key);
      if (series === undefined) continue;
      if (plot.ohlc !== undefined) {
        series.setData(this._ohlcPoints(plot, plot.ohlc, values, bars, settings));
        continue;
      }
      const col = values[plot.key];
      if (col === undefined) {
        series.setData([]);
        continue;
      }
      const colorBy = plot.colorBy;
      const colorParts = plot.colorParts;
      const out = new Array<{ time: number; value: number; color?: string }>(n);
      for (let i = 0; i < n; i++) {
        const v = col[i];
        const value = v === null || v === undefined ? NaN : v;
        const point: { time: number; value: number; color?: string } = { time: bars[i].time, value };
        if (Number.isFinite(value)) {
          // A value column has only a body to paint; the split form's wick and
          // border are for the candle plot, see `_ohlcPoints`.
          const body = colorParts?.({ value, index: i, values, settings })?.body
            ?? colorBy?.({ value, index: i, values, settings });
          if (body !== undefined) point.color = body;
        }
        out[i] = point;
      }
      series.setData(out);
    }
    this._syncFills();
    this._syncMarkers(bars);
    this._syncTable(bars);
    this._syncDraws(bars);
    this._syncBackground(bars);
    this._syncBarColors(bars);
    this._applyLevels(bars, settings);
    this._syncAlerts(bars, settings, tailOnly);
    this.updateLegendValues(this._host.legendIndex?.());
  }

  /**
   * Bar-shaped points for a plot that names four columns. Validated here rather
   * than at registration: a descriptor declares column *names*, and whether
   * `calc` actually returns them is only knowable once it has run, which is
   * inside the constructor, so a wrong name still throws out of `addIndicator`
   * instead of drawing an empty pane.
   */
  private _ohlcPoints(
    plot: IndicatorPlot,
    ohlc: NonNullable<IndicatorPlot['ohlc']>,
    values: IndicatorValues,
    bars: readonly Bar[],
    settings: Readonly<IndicatorSettings>,
  ): Bar[] {
    const n = bars.length;
    const cols = [ohlc.open, ohlc.high, ohlc.low, ohlc.close].map((key) => {
      const col = values[key];
      if (col === undefined || col.length !== n) {
        throw new Error(
          `openalgo-charts: ${this.indicatorId} plot "${plot.key}" ohlc column "${key}" must be ${n} values`,
        );
      }
      return col;
    });
    const colorBy = plot.colorBy;
    const colorParts = plot.colorParts;
    const out = new Array<Bar>(n);
    for (let i = 0; i < n; i++) {
      const close = cols[3][i];
      const value = close === null ? NaN : close;
      const bar: Bar = {
        time: bars[i].time,
        open: cols[0][i] ?? NaN,
        high: cols[1][i] ?? NaN,
        low: cols[2][i] ?? NaN,
        close: value,
      };
      if (Number.isFinite(value)) {
        const c = colorBy?.({ value, index: i, values, settings });
        if (c !== undefined) bar.color = c;
        const parts = colorParts?.({ value, index: i, values, settings });
        if (parts !== undefined) {
          if (parts.body !== undefined) bar.color = parts.body;
          if (parts.wick !== undefined) bar.wickColor = parts.wick;
          if (parts.border !== undefined) bar.borderColor = parts.border;
        }
      }
      out[i] = bar;
    }
    return out;
  }

  /**
   * Rebuild the reference levels. Runs after every `calc` so a data-derived
   * level (the previous day's high, a session VWAP band) follows the data, but
   * the great majority of levels are constants, so a signature compare keeps a
   * live tick from detaching and reattaching a price line per level per bar.
   */
  private _applyLevels(bars: readonly Bar[], settings: Readonly<IndicatorSettings>): void {
    if (this._d.levels === undefined) return;
    // The context spreads the settings keys onto itself so descriptors written
    // against the original `levels(settings)` signature read what they always
    // did. See `IndicatorLevelContext`.
    const ctx: IndicatorLevelContext = { ...settings, settings, bars, values: this._values };
    const levels = this._visible ? this._d.levels(ctx) : [];
    let sig = '';
    for (const l of levels) {
      sig += `${l.price}|${l.color ?? ''}|${l.title ?? ''}|${l.dashed ?? ''}|${l.lineWidth ?? ''}|${l.lineStyle ?? ''};`;
    }
    if (sig === this._levelSig) return;
    this._levelSig = sig;
    for (const line of this._levels) this._host.removeIndicatorLevel(line);
    this._levels = [];
    let i = 0;
    for (const l of levels) {
      // `dashed` predates `lineStyle` and stays the fallback, defaulting to a
      // dashed line the way every built-in level already draws.
      const lineStyle: IndicatorLineStyle = l.lineStyle ?? (l.dashed === false ? 'solid' : 'dashed');
      this._levels.push(
        this._host.addIndicatorLevel(
          {
            price: l.price,
            color: l.color ?? '#8892a6',
            dashed: lineStyle === 'dashed',
            lineWidth: l.lineWidth ?? 1,
            lineStyle,
            label: l.title ?? '',
            id: `${this.id}:level:${i++}`,
          },
          this.paneIndex,
        ),
      );
    }
  }

  private _applyRange(): void {
    if (!this._ownPane) return; // a shared pane belongs to whoever created it
    this._host.setPaneRange(this.paneIndex, this._d.range?.(this._descriptorSettings()) ?? null);
  }

  public remove(): void {
    if (this._removed) return;
    this._removed = true;
    this._lifetime.abort();
    this._dataRetry = null;
    this._dataListeners.clear();
    try { this._detach?.(); } catch { /* External cleanup cannot retain the indicator's chart resources. */ }
    this._detach = null;
    for (const primitive of this._attachedPrimitives) this._host.removeIndicatorPrimitive?.(primitive);
    this._attachedPrimitives.clear();
    if (this._legend !== null) { this._host.removeIndicatorLegend(this._legend); this._legend = null; }
    for (const line of this._levels) this._host.removeIndicatorLevel(line);
    this._levels = [];
    for (const series of this._series.values()) series.remove();
    this._series.clear();
    for (const band of this._fills) this._host.removeIndicatorFill(band);
    this._fills.length = 0;
    if (this._markers !== null) { this._host.removeIndicatorMarkers(this._markers); this._markers = null; }
    if (this._table !== null) { this._host.removeIndicatorTable(this._table); this._table = null; }
    if (this._draws !== null) { this._host.removeIndicatorPrimitive?.(this._draws); this._draws = null; }
    if (this._background !== null) { this._host.removeIndicatorPrimitive?.(this._background); this._background = null; }
    // Withdraw the candle colours before anything else forgets who owned them.
    if (this._d.barColors !== undefined) this._host.setBarColors?.(null, this.id);
    if (this._ownPane) this._host.setPaneRange(this.paneIndex, null);
    this._host.indicatorRemoved?.(this.id);
  }
}

/**
 * Overlay a `calcTail` result (values for `[from, n)`) onto the previous full
 * result. Any key the tail omits, or a previous column of the wrong length,
 * forces the caller back to a full recompute by returning `null`.
 */
function spliceTail(
  previous: IndicatorValues,
  tail: IndicatorValues,
  from: number,
  n: number,
): IndicatorValues | null {
  const out: Record<string, (number | null)[]> = {};
  for (const key of Object.keys(tail)) {
    const prev = previous[key];
    const add = tail[key];
    if (prev === undefined || add === undefined) return null;
    if (add.length !== n - from) return null;
    const col = new Array<number | null>(n);
    for (let i = 0; i < from; i++) col[i] = prev[i] ?? null;
    for (let i = from; i < n; i++) col[i] = add[i - from] ?? null;
    out[key] = col;
  }
  return out;
}
