import {
  getIndicator, parsePaneState, registeredIndicators,
  type Chart, type ChartRestoreOptions, type IndicatorDescriptor, type IndicatorState, type IndicatorStudySource,
  type PaneState, type PriceScaleId, type PriceScaleState,
} from 'openalgo-charts';
import {
  parseIndicatorStates, parseIndicatorTemplatePayload,
  type IndicatorTemplateInput, type IndicatorTemplateLayout, type IndicatorTemplatePayload, type IndicatorTemplatePlotBinding,
} from './documents';
import { choice, readJson, record, WorkspaceDocumentError } from './json';
import { planIndicatorTemplate, remapTemplateIndicatorIds, type IndicatorTemplateMode } from './templates';

export interface IndicatorTemplateApplyOptions {
  /** Copy isolates non-primary main-pane scales; share keeps existing destination settings. */
  scalePolicy?: 'copy' | 'share';
  /** Auto fits copied axes to current data or their fixed band; preserve retains saved views. */
  rangePolicy?: 'auto' | 'preserve';
}

export interface IndicatorTemplatePlan {
  indicators: IndicatorState[];
  panes?: PaneState[];
  /** Forward as restoreState's second argument to retain destination runtime formatters. */
  restoreOptions?: ChartRestoreOptions;
}

function scaleEntries(pane: PaneState): [PriceScaleId, PriceScaleState][] {
  return [['right', pane.priceScale], ...Object.entries(pane.scales ?? {})] as [PriceScaleId, PriceScaleState][];
}

function scaleState(pane: PaneState, id: PriceScaleId): PriceScaleState | undefined {
  return id === 'right' ? pane.priceScale : pane.scales?.[id];
}

function primaryId(chart: Chart, pane: PaneState): PriceScaleId | undefined {
  const primary = chart.primarySeries();
  if (!primary) return undefined;
  const target = primary.priceScale();
  return scaleEntries(pane).find(([id]) => chart.panes()[0].scaleFor(id) === target)?.[0];
}

/** Capture effective bindings and scale configuration, without data or runtime callbacks. */
export function captureIndicatorTemplate(chart: Chart): IndicatorTemplatePayload {
  const state = chart.getState(), panes = state.panes;
  if (!panes?.length) throw new WorkspaceDocumentError('Cannot capture a destroyed chart');
  const plots: IndicatorTemplatePlotBinding[] = [];
  for (const instance of chart.indicators()) for (const plot of getIndicator(instance.indicatorId).plots) {
    const handle = instance.series(plot.key), scaleId = instance.plotPriceScaleId(plot.key);
    if (!handle || chart.seriesType(handle) === null || scaleId === null) {
      throw new WorkspaceDocumentError('Cannot capture a removed indicator plot');
    }
    plots.push({ instanceId: instance.id, plotKey: plot.key, paneIndex: plot.overlay === true ? 0 : instance.paneIndex, scaleId });
  }
  const layout: IndicatorTemplateLayout = { panes, plots };
  const id = primaryId(chart, panes[0]);
  if (id !== undefined) layout.primaryScaleId = id;
  return parseIndicatorTemplatePayload({ indicators: state.indicators ?? [], layout });
}

function validateBindings(studies: readonly IndicatorState[], layout: IndicatorTemplateLayout): Map<string, IndicatorTemplatePlotBinding[]> {
  const byStudy = new Map<string, IndicatorTemplatePlotBinding[]>();
  for (const binding of layout.plots) {
    const group = byStudy.get(binding.instanceId) ?? [];
    group.push(binding); byStudy.set(binding.instanceId, group);
  }
  for (const study of studies) {
    const descriptor = getIndicator(study.indicatorId), bindings = byStudy.get(study.instanceId!) ?? [];
    const inputs = descriptor.inputs.filter(input => input.type === 'source'
      && typeof (Object.prototype.hasOwnProperty.call(study.settings, input.key) ? study.settings[input.key] : input.default) !== 'string');
    const declared = new Set(study.studyInputs ?? []);
    if (inputs.length !== declared.size || inputs.some(input => !declared.has(input.key)
      || input.type !== 'source' || input.allowStudyOutputs !== true)) {
      throw new WorkspaceDocumentError('Template dependency metadata disagrees with its source inputs');
    }
    for (const key of declared) {
      const reference = study.settings[key] as IndicatorStudySource;
      const producer = studies.find(candidate => candidate.instanceId === reference.instanceId)!;
      const selected = getIndicator(producer.indicatorId).plots.filter(plot => plot.key === reference.plotKey);
      if (selected.length !== 1 || selected[0].ohlc !== undefined) {
        throw new WorkspaceDocumentError('Template study source must identify one declared scalar plot');
      }
    }
    if (bindings.length !== descriptor.plots.length) throw new WorkspaceDocumentError('Template needs every declared plot binding');
    for (const binding of bindings) {
      const plot = descriptor.plots.find(item => item.key === binding.plotKey);
      if (!plot || binding.paneIndex !== (plot.overlay === true ? 0 : study.paneIndex)) {
        throw new WorkspaceDocumentError('Template plot key or pane disagrees with its descriptor');
      }
    }
    validateFills(descriptor, study, bindings);
  }
  return byStudy;
}

function validateFills(descriptor: IndicatorDescriptor, study: IndicatorState, bindings: readonly IndicatorTemplatePlotBinding[]): void {
  const firstLocal = descriptor.plots.find(plot => plot.overlay !== true);
  const local = firstLocal ? bindings.find(binding => binding.plotKey === firstLocal.key)!.scaleId : study.priceScaleId ?? 'right';
  for (const fill of descriptor.fills ?? []) {
    const pane = fill.overlay === true ? 0 : study.paneIndex;
    const endpoints = fill.between.map(key => bindings.find(binding => binding.plotKey === key)
      ?? { paneIndex: pane, scaleId: fill.overlay === true ? 'right' : local });
    if (endpoints.some(endpoint => endpoint.paneIndex !== pane) || endpoints[0].scaleId !== endpoints[1].scaleId) {
      throw new WorkspaceDocumentError('Template fill endpoints must share their pane and scale');
    }
  }
}

function hostPanes(chart: Chart): Set<number> {
  const counts = chart.panes().map(pane => pane.series().length);
  for (const instance of chart.indicators()) for (const plot of getIndicator(instance.indicatorId).plots) {
    const handle = instance.series(plot.key);
    if (handle && chart.seriesType(handle) !== null) counts[plot.overlay === true ? 0 : instance.paneIndex]--;
  }
  return new Set(counts.flatMap((count, index) => count > 0 ? [index] : []));
}

function defaultScale(): PriceScaleState {
  return { marginTop: 0.1, marginBottom: 0.1, minMove: 0, minPrecision: 0, mode: 'linear', inverted: false, autoScale: true };
}

function copiedScale(source: PriceScaleState, owners: ReadonlyMap<string, string>, preserve: boolean): PriceScaleState {
  const scale = parsePaneState({ weight: 1, priceScale: source }).priceScale;
  if (preserve) {
    if (scale.indicatorRange) scale.indicatorRange.instanceId = owners.get(scale.indicatorRange.instanceId)!;
  } else {
    scale.autoScale = true;
    delete scale.range; delete scale.ratioLock;
    if (scale.indicatorRange) { delete scale.indicatorRange; delete scale.fixedRange; }
  }
  return scale;
}

function clearOutgoingOwners(panes: PaneState[], outgoing: ReadonlySet<string>): void {
  for (const pane of panes) for (const [, scale] of scaleEntries(pane)) {
    const owner = scale.indicatorRange;
    if (!owner || !outgoing.has(owner.instanceId)) continue;
    delete scale.indicatorRange; delete scale.fixedRange;
    if (!owner.manual) { scale.autoScale = true; delete scale.range; delete scale.ratioLock; }
  }
}

/** Plan a detached patch. The host owns restore, cancellation and recovery. */
export function planIndicatorTemplateState(chart: Chart, incoming: IndicatorTemplateInput, mode: IndicatorTemplateMode,
  options: IndicatorTemplateApplyOptions = {}): IndicatorTemplatePlan {
  if (mode !== 'replace' && mode !== 'append') throw new WorkspaceDocumentError('Unsupported indicator template mode');
  const settings = record(readJson(options), 'template apply options');
  const policy = choice(settings.scalePolicy, 'scale policy', ['copy', 'share'] as const, 'copy');
  const preserve = choice(settings.rangePolicy, 'range policy', ['auto', 'preserve'] as const, 'auto') === 'preserve';
  const incomingState = parseIndicatorTemplatePayload(incoming), current = chart.getState();
  if (!current.panes?.length) throw new WorkspaceDocumentError('Cannot plan for a destroyed chart');
  const available = new Set(registeredIndicators().map(item => item.id));
  if (!incomingState.layout) {
    return { indicators: planIndicatorTemplate(current.indicators ?? [], incomingState.indicators, mode, available, current.panes.length) };
  }
  const layout = incomingState.layout, additions = incomingState.indicators, previous = parseIndicatorStates(current.indicators ?? []);
  const planned = mode === 'append' ? [...previous, ...additions] : additions;
  if (planned.length > 256) throw new WorkspaceDocumentError('At most 256 indicator instances are supported');
  const missing = [...new Set(planned.filter(study => !available.has(study.indicatorId)).map(study => study.indicatorId))];
  if (missing.length) throw new WorkspaceDocumentError(`Missing indicators: ${missing.join(', ')}`);
  const bindings = validateBindings(additions, layout);
  const reservedPanes = mode === 'replace' ? hostPanes(chart) : new Set<number>();
  const restoreOptions: ChartRestoreOptions = { preserveScaleFormats: current.panes.flatMap((pane, paneIndex) =>
    paneIndex === 0 || mode === 'append' || reservedPanes.has(paneIndex)
      ? scaleEntries(pane).map(([scaleId]) => ({ paneIndex, scaleId })) : []) };
  if (mode === 'append' && !additions.length) return { indicators: previous, restoreOptions };
  const destinationPrimary = primaryId(chart, current.panes[0]);
  const panes = current.panes.map(pane => parsePaneState(pane));
  if (mode === 'replace') clearOutgoingOwners(panes, new Set(previous.flatMap(study => study.instanceId ? [study.instanceId] : [])));
  const paneMap = new Map<number, number>([[0, 0]]);
  let nextPane = mode === 'append' ? panes.length : 1;
  for (const sourcePane of [...new Set(additions.map(study => study.paneIndex).filter(index => index > 0))].sort((a, b) => a - b)) {
    while (reservedPanes.has(nextPane)) nextPane++;
    if (nextPane > 31) throw new WorkspaceDocumentError('Indicator pane limit exceeded');
    paneMap.set(sourcePane, nextPane++);
  }
  const originalIds = additions.map(study => study.instanceId!);
  const owners = remapTemplateIndicatorIds(previous, additions);
  for (const [sourcePane, targetPane] of paneMap) {
    if (!sourcePane) continue;
    const source = layout.panes[sourcePane];
    const weight = source.weight / layout.panes[0].weight * panes[0].weight;
    if (!(weight > 0) || !Number.isFinite(weight)) throw new WorkspaceDocumentError('Template pane weight is not representable');
    const entries = scaleEntries(source).map(([id, scale]) => [id, copiedScale(scale, owners, preserve)] as const);
    panes[targetPane] = { weight, priceScale: entries[0][1],
      ...(entries.length > 1 ? { scales: Object.fromEntries(entries.slice(1)) } : {}) };
  }
  const main = panes[0], originalMainIds = new Set(scaleEntries(main).map(([id]) => id));
  const scaleMap = new Map<PriceScaleId, PriceScaleId>();
  const copiedColumns: { id: PriceScaleId; source: PriceScaleState }[] = [];
  let nextScale = 1;
  const mapScale = (pane: number, id: PriceScaleId): PriceScaleId => {
    if (pane > 0) return id;
    const cached = scaleMap.get(id);
    if (cached !== undefined) return cached;
    if (id === layout.primaryScaleId && destinationPrimary !== undefined) {
      scaleMap.set(id, destinationPrimary); return destinationPrimary;
    }
    let target = id;
    if (policy === 'copy') {
      do { target = `overlay:template-scale-${additions[0].instanceId}-${nextScale++}`; } while (scaleState(main, target));
    }
    scaleMap.set(id, target);
    if (!scaleState(main, target)) {
      const source = scaleState(layout.panes[0], id) ?? defaultScale();
      const scale = copiedScale(source, owners, preserve);
      if (target === 'right') main.priceScale = scale;
      else { main.scales ??= {}; main.scales[target] = scale; }
      if (policy === 'copy') copiedColumns.push({ id: target, source: { ...source,
        placement: source.placement ?? { side: id === 'left' || id === 'right' ? id : 'hidden', order: 0 } } });
    }
    return target;
  };
  additions.forEach((study, index) => {
    const original = originalIds[index], originalPane = study.paneIndex;
    const maps = (bindings.get(original) ?? []).map(binding => [binding.plotKey, mapScale(binding.paneIndex, binding.scaleId)]);
    if (maps.length) study.plotPriceScaleIds = Object.fromEntries(maps);
    if (study.priceScaleId !== undefined) study.priceScaleId = mapScale(originalPane, study.priceScaleId);
    else if (!getIndicator(study.indicatorId).plots.some(plot => plot.overlay !== true)) study.priceScaleId = mapScale(originalPane, 'right');
    study.paneIndex = paneMap.get(originalPane)!;
    // Unplotted overlay fill columns always use the native right fallback.
    // A primary relation remap must remain representable by that same contract.
    validateFills(getIndicator(study.indicatorId), study, (bindings.get(original) ?? []).map(binding => ({ ...binding,
      paneIndex: paneMap.get(binding.paneIndex)!, scaleId: study.plotPriceScaleIds![binding.plotKey] })));
  });
  for (const side of ['left', 'right', 'hidden'] as const) {
    let order = Math.max(-1, ...scaleEntries(main).filter(([id]) => originalMainIds.has(id))
      .map(([id, scale]) => scale.placement ?? { side: id === 'left' || id === 'right' ? id : 'hidden', order: 0 })
      .filter(placement => placement.side === side).map(placement => placement.order)) + 1;
    for (const column of copiedColumns.filter(column => column.source.placement!.side === side)
      .sort((a, b) => a.source.placement!.order - b.source.placement!.order)) {
      scaleState(main, column.id)!.placement = { side, order: order++ };
    }
  }
  return { indicators: planned, panes, restoreOptions };
}
