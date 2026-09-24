# Native chart and indicator capabilities

The scope is missing functionality through native chart and indicator APIs, with compatibility checks against the companion script engine. Existing native and custom broker feeds remain the integration path. A drop-in API facade and an additional feed compatibility adapter are excluded at the user's request.

The [design](design.md) sets the boundaries and the [plan](plan.md) lists the remaining work. [progress.json](progress.json) records implementation status. Full capability coverage has not been established.

## Implemented

- A saved CSS-pixel spacing preference keeps candle density consistent across screen widths. The widget defaults to 8 pixels while explicit count preferences remain supported.
- Mouse and pen drift up to 3 pixels no longer disables price autofit during horizontal dragging. Deliberate vertical panning and already-manual axes retain their behavior.
- Fill descriptors support per-bar colors and static or computed gradients across a whole band.
- Indicators can own multiple named tables, including price-pane overlays. Their resources follow visibility, updates, pane moves and removal.
- Fourteen numerical helpers add statistics, running extrema and crossing/rising/falling predicates with explicit missing-observation rules.
- Chart and workspace snapshots preserve existing secondary scales, precision, fixed/manual ranges and ratio locks. Symbol changes clear view ranges from every scale.
- Known fixed intervals confirm the newest bar at its recorded opening plus its duration, including sparse data and weekend gaps.
- Registered calendar intervals use the next boundary in their configured timezone.
- A single forming bar remains unconfirmed until its interval closes.
- Unknown and count-driven intervals are not guessed from elapsed time. Provider-driven confirmation remains unfinished.
- Existing hosts without interval metadata retain their previous behavior.
- An optional integration runner compiles actual programs and exercises the public chart adapter. It checks plotted values, time units, deferred signals, tail updates, settings isolation and table cleanup. It also typechecks the public descriptor assignment.

## Verification

The confirmation regression suite has 12 cases; nine reproduced failures before the fix. Four compiled-program integration cases passed against the pinned engine revision `833ce15f7ec1bb0ab8ae203b800c8858ce3b4339`. These checks cover specific behaviors, not every capability.

Run against a built script-engine checkout:

```powershell
npm run test:script-engine -- D:/path/to/script-engine
```

The command fails if the checkout is missing, unbuilt, incompatible or fails the tests. It adds no runtime dependency and does not modify the supplied checkout.

The unchanged chart baseline `a1828e9ac948d2f9aebe0657f421987a85d6f2a7` measured 55.58 KiB for the chart-only build. The confirmation fix measured 56.09 KiB. The 56.25 KiB budget covers the interval and calendar logic; optional tiers must still be removed by tree shaking.

## Remaining work

Lifecycle provenance, requested-context calculations, dependent study inputs, numerical helpers, typed and interactive inputs, remaining visual variants, alert policies, chart APIs, persistence and provider capabilities still need implementation and behavioral checks. Comparative research belongs outside the repository. Implement features from documented behavior using independently written code and tests.
