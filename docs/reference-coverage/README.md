# Native chart and indicator capabilities

The scope is missing functionality through native chart and indicator APIs, with compatibility checks against the companion script engine. Existing native and custom broker feeds remain the integration path. A drop-in API facade and an additional feed compatibility adapter are excluded at the user's request.

The [design](design.md) sets the boundaries and the [plan](plan.md) lists the remaining work. [progress.json](progress.json) records implementation status. Full capability coverage has not been established.

## Implemented

- A saved CSS-pixel spacing preference keeps candle density consistent across screen widths. The widget defaults to 8 pixels while explicit count preferences remain supported.
- Mouse and pen drift up to 3 pixels no longer disables price autofit during horizontal dragging. Deliberate vertical panning and already-manual axes retain their behavior.
- Fill descriptors support per-bar colors and gradients, plus static or computed whole-band gradients. Price anchors remain aligned during panning, inversion and pane movement.
- Indicators can own multiple named tables, including price-pane overlays. Their resources follow visibility, updates, pane moves and removal.
- Table cells support merged rows and columns, multiline text, italic and font-family choices, vertical alignment and an independent outer frame.
- Fourteen numerical helpers add statistics, running extrema and crossing/rising/falling predicates with explicit missing-observation rules.
- Eleven established numerical helpers accept optional missing-value policies while retaining omitted-option behavior. The new paths preserve finite extreme averages and deviations.
- Nine window helpers accept aligned per-bar lengths; both pivot helpers accept per-bar left/right widths. Scalar behavior remains unchanged, and missing observations retain their original indices.
- `securityExpression` calculates on aggregate timeframe bars before aligning results, with confirmed, developing and explicit lookahead modes. Session anchors use local wall-clock time across offset changes.
- Requested-observation helpers calculate before alignment or intrabar grouping, using explicit confirmation and availability. Carry and missing-result policies retain original indices and block unavailable prefixes.
- Native providers can optionally return availability snapshots. Requests combine caller, instance, provider and market-context cancellation, and obsolete replies reject even when a provider ignores its signal.
- Managed requested expressions refresh same-time changes, preserve pending work across style edits, isolate replay cutoffs and report calculation failures without replacing accepted data. Hosts can announce external changes without inventing price ticks.
- Timed replay publishes availability-clock movement within an unchanged primary observation. Interrupted replay writes cannot overwrite a later stop or seek.
- Direct time-scale navigation repaints and publishes settled range events to linked charts. Explicit same-range requests cancel pending motion, and reentrant restore callbacks receive a final repaint.
- Native series renderer changes and widget chart-type changes retain series handles, data, styles, price scales and marker bindings. Live type lookup keeps host controls and saved state synchronized.
- Independent host-owned series can change price scales while retaining their handle, data, markers and pane. Configured vacant scales retain their settings without reserving visible axis columns.
- Whole studies can move their local plots, fills, levels and drawings between scales without replacing resources or recalculating. Explicit price-pane overlays retain their placement. Owned default ranges preserve manual views, shared studies and saved state.
- Bound primitives use their assigned scale for painting, hit-testing, dragging, measurement and vector export. Left-side reference labels stay within the axis; hidden scales omit axis labels.
- Left axes display primary price and countdown labels plus independent secondary-series tags. Hidden axes omit those labels, and label placement is bounded to the price-axis area.
- Chart and workspace snapshots preserve existing secondary scales, precision, fixed/manual ranges and ratio locks. Symbol changes clear view ranges from every scale.
- Known fixed intervals confirm the newest bar at its recorded opening plus its duration, including sparse data and weekend gaps.
- Registered calendar intervals use the next boundary in their configured timezone.
- A single forming bar remains unconfirmed until its interval closes.
- Providers can explicitly mark the newest bar forming or confirmed, including count-driven bars. Replay preserves that authority on exit. Older corrections cannot change the current tail's confirmation.
- Native calculations distinguish historical, live and replay updates. Source identity and history revisions invalidate cached prefixes after replacements or corrections; a replacement primary source cannot inherit the previous source's cache.
- Existing hosts without interval metadata retain their previous behavior.
- An optional integration runner compiles actual programs and exercises the public chart adapter. It checks plotted values, time units, deferred signals, tail updates, settings isolation and table cleanup. It also typechecks the public descriptor assignment.

## Verification

The confirmation regression suite has 12 cases; nine reproduced failures before the fix. A further 23 provenance cases cover native source lifecycle. Twelve compiled-program integration cases passed against the pinned engine revision `833ce15f7ec1bb0ab8ae203b800c8858ce3b4339`, including native timeframe composition, persistent calculations, forming-bar rollback, provider confirmation and managed requested observations. These checks cover specific behaviors, not every capability.

Run against a built script-engine checkout:

```powershell
npm run test:script-engine -- D:/path/to/script-engine
```

The command fails if the checkout is missing, unbuilt, incompatible or fails the tests. It adds no runtime dependency and does not modify the supplied checkout.

The unchanged chart baseline `a1828e9ac948d2f9aebe0657f421987a85d6f2a7` measured 55.58 KiB for the chart-only build. The first confirmation build measured 56.09 KiB and used a 56.25 KiB budget. Current measurements are recorded in `progress.json`; optional tiers must still be removed by tree shaking.

## Remaining work

The existing raw external helper's refresh lifecycle, dependent study inputs, numerical helpers, typed and interactive inputs, remaining visual variants, alert policies, chart APIs, persistence and provider capabilities still need implementation and behavioral checks. [Scale ownership](scale-ownership.md) records the completed transaction and remaining axis work. [Requested providers](requested-providers.md) documents the new native snapshot path; [study dependencies](study-dependencies.md) defines the next input graph. Comparative research belongs outside the repository. Implement features from documented behavior using independently written code and tests.
