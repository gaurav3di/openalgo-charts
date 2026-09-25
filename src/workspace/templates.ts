import type { IndicatorState } from 'openalgo-charts';
import { parseIndicatorStates, parseTemplateIndicatorStates } from './documents';
import { WorkspaceDocumentError } from './json';

export type IndicatorTemplateMode = 'replace' | 'append';

/**
 * Validate and detach a study plan before the host changes a chart. Append keeps
 * current instance identities and places positive incoming pane groups after the
 * existing panes; pane zero remains the price pane. Dependency copies receive fresh
 * identities; legacy independent studies leave identity allocation to the chart.
 * Pass the chart's pane count as nextPaneIndex. This function creates no chart or UI.
 */
export function planIndicatorTemplate(
  current: IndicatorState[], incoming: IndicatorState[], mode: IndicatorTemplateMode,
  available: ReadonlySet<string>, nextPaneIndex: number,
): IndicatorState[] {
  if (mode !== 'replace' && mode !== 'append') throw new WorkspaceDocumentError('Unsupported indicator template mode');
  const previous = parseIndicatorStates(current);
  // User-authored dependency templates supply studyInputs explicitly. Ordinary
  // settings records are opaque, even when they resemble a source reference.
  const additions = parseTemplateIndicatorStates(incoming);
  if (additions.some(item => item.studyInputs?.length)) remapTemplateIndicatorIds(previous, additions);
  if (mode === 'append') {
    const lastOccupied = Math.max(0, ...previous.map(item => item.paneIndex));
    if (!Number.isInteger(nextPaneIndex) || nextPaneIndex <= lastOccupied || nextPaneIndex > 32) {
      throw new WorkspaceDocumentError('Invalid next indicator pane');
    }
    const groups = [...new Set(additions.map(item => item.paneIndex).filter(index => index > 0))].sort((a, b) => a - b);
    for (const item of additions) {
      if (item.paneIndex > 0) item.paneIndex = nextPaneIndex + groups.indexOf(item.paneIndex);
      if (item.paneIndex > 31) throw new WorkspaceDocumentError('Indicator pane limit exceeded');
    }
  }
  const planned = mode === 'replace' ? additions : [...previous, ...additions];
  if (planned.length > 256) throw new WorkspaceDocumentError('At most 256 indicator instances are supported');
  const missing = [...new Set(planned.filter(item => !available.has(item.indicatorId)).map(item => item.indicatorId))];
  if (missing.length) throw new WorkspaceDocumentError(`Missing indicators: ${missing.join(', ')}`);
  return planned;
}

/** Internal copy identity allocator, shared by legacy graphs and rich layouts. */
export function remapTemplateIndicatorIds(previous: readonly IndicatorState[], additions: IndicatorState[]): Map<string, string> {
  const remapped = new Map<string, string>();
  if (!additions.length) return remapped;
  const reserved = new Set([...previous, ...additions].flatMap(item => item.instanceId === undefined ? [] : [item.instanceId]));
  // A missing producer's identity must not be acquired by a newly copied study.
  for (const item of previous) for (const key of item.studyInputs ?? []) {
    reserved.add((item.settings[key] as { instanceId: string }).instanceId);
  }
  // Removed studies can still own saved alert anchors, including after a reload.
  // A random copy namespace stays distinct when current contains no old studies.
  if (!globalThis.crypto?.getRandomValues) throw new WorkspaceDocumentError('Random IDs are unavailable for connected template copies');
  const namespace = Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)),
    value => value.toString(16).padStart(8, '0')).join('');
  let next = 1;
  for (const item of additions) {
    let id: string;
    do { id = `template-study-${namespace}-${next++}`; } while (reserved.has(id));
    reserved.add(id);
    if (item.instanceId !== undefined) remapped.set(item.instanceId, id);
    item.instanceId = id;
  }
  for (const item of additions) for (const key of item.studyInputs ?? []) {
    const reference = item.settings[key] as { kind: 'indicator'; instanceId: string; plotKey: string };
    item.settings[key] = { ...reference, instanceId: remapped.get(reference.instanceId)! };
  }
  return remapped;
}
