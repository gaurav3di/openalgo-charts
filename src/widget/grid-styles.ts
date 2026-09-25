/**
 * The chart grid's rules. Kept apart from grid.ts so the shared component
 * sheet can carry them without importing the grid, which imports the shell.
 * Every colour is a widget token, written on the grid root by the grid.
 */
export const CHART_GRID_CSS = `
.oac-grid { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0;
  background: var(--oac-bg); color: var(--oac-tx); font: var(--oac-fs)/1.35 var(--oac-font); }
.oac-grid [hidden] { display: none !important; }
.oac-grid__tabs { display: flex; gap: 2px; padding: 4px; overflow-x: auto; flex: none; background: var(--oac-panel);
  border-bottom: 1px solid var(--oac-bd-soft); scrollbar-width: thin; scrollbar-color: var(--oac-sb-thumb) transparent; }
.oac-grid__tabs::-webkit-scrollbar { height: 6px; }
.oac-grid__tabs::-webkit-scrollbar-thumb { background: var(--oac-sb-thumb); border-radius: 999px; }
.oac-grid__tab { flex: none; height: 26px; padding: 0 10px; border: 1px solid transparent; border-radius: var(--oac-radius);
  background: transparent; color: var(--oac-mut); font: inherit; cursor: pointer; white-space: nowrap; }
.oac-grid__tab:hover { color: var(--oac-tx); background: var(--oac-elev); }
.oac-grid__tab[aria-selected="true"] { color: var(--oac-tx-strong); background: var(--oac-on-bg); border-color: var(--oac-on-bd); }
.oac-grid__tab:focus-visible, .oac-grid__split:focus-visible { outline: 2px solid var(--oac-ring); outline-offset: -2px; }
.oac-grid__cells { position: relative; flex: 1; display: grid; min-height: 0; background: var(--oac-bd-soft); }
.oac-grid__cell { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.oac-grid__cell::after { content: ''; position: absolute; inset: 0; border: 1px solid transparent; pointer-events: none; z-index: 30; }
.oac-grid[data-single="false"][data-compact="false"] .oac-grid__cell[data-active="true"]::after { border-color: var(--oac-acc); }
.oac-grid__split { position: relative; z-index: 31; touch-action: none; transition: background .12s; }
.oac-grid__split::before { content: ''; position: absolute; inset: 0 -3px; }
.oac-grid__split[data-axis="row"]::before { inset: -3px 0; }
.oac-grid__split[data-axis="column"] { cursor: col-resize; }
.oac-grid__split[data-axis="row"] { cursor: row-resize; }
.oac-grid__split:hover, .oac-grid__split.is-drag { background: var(--oac-acc); }
.oac-grid[data-compact="true"] .oac-grid__cells { grid-template: minmax(0,1fr) / minmax(0,1fr) !important; }
.oac-grid[data-compact="true"] .oac-grid__cell { grid-area: 1 / 1 / 2 / 2 !important; }
`;
