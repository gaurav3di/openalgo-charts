# Numerical audit

The audit inventories all 105 shipped indicator descriptors and compares
equivalent calculations with both companion language engines. Inventory and
successful execution are not numerical conformance. The complete audit remains
open, including documented differences in seeds and missing-value behavior.

## Directional movement seed

Positive and negative movement now seed from the same first real change window
as true range. A synthetic rising series with a unit movement and a two-unit
range therefore reports positive direction 50 as soon as it is available.
Including a fabricated zero movement at the first bar previously biased this
reading downward.

For high/low/close rows `(10,8,9)`, `(12,9,11)`, `(11,7,8)`, `(13,9,12)` and
`(12,10,11)`, with both lengths set to 2, independently derived strength is
`[null,null,null,25,37.5]`. The final positive and negative readings are 24 and 8.
Both companion engines already produce these ordinary-case results.

The change preserves first-available indices and the established chart behavior
on zero range and absent observations. Those missing-value contracts still need
separate comparison; ordinary-case equality does not certify them.

Verification includes 129 focused unit tests, same-time chart updates and prefix
execution. A built-package browser regression first reproduced the old wrong
values, then passed exact readings and rendered-line pixels in all three browser
engines. Screenshots were inspected. Typechecking, scoped lint, build and bundle
budgets passed. That development build measured 36.00 kB Brotli for the indicator
tier and 289.25 kB for all tiers together.

## Hull window lengths

The standalone HMA now shares the integer-window kernel used by Hull Suite's Hma
mode and both companion engines. The fast window is `max(1,floor(length/2))` and
the smoothing window is `max(1,round(sqrt(length)))`. Length 1 returns its source.
The former fractional half window changed the slope response at odd lengths;
flooring the outer square root could also emit a value before the agreed warmup.

Independent straight-line lag fixtures cover lengths 1, 2, 9, 13, 16 and 25.
At length 9 a ramp is followed without lag once warm; at length 13 the lag is
one third of a bar and the first reading is at zero-based index 15. Flat values,
source holes, recovery and prefix execution are checked separately. These are
formula comparisons; unchanged summation orders can still differ in last bits
from the companion engines and remain part of the wider audit.

The Hull batch passes 173 focused unit tests, typechecking and scoped lint.
Built-package Hull and directional-value regressions pass in all three browser
engines, with screenshots inspected. Fifteen matching compiled programs produce
identical bits between the companion engines. The six Hull fixtures now match
the chart formulas and availability within the stated `1e-12` comparison;
directional zero-range and absent-data differences remain open. The current
build measures 35.90 kB Brotli for indicators and 289.15 kB for all tiers, within
their budgets.

The companion audit additionally reproduced and corrected changing-length,
volume-anchor, overflow and partial-output disagreements. Both packages are
published at 0.7.0 from source `f9ab00e4`. The chart release remains 2.5.4 and is
pending the remaining native capability work.

## Wider compiled comparisons

The complete descriptor inventory now exercises all 105 descriptors and 266
declared outputs. The 1,148 compiled cases compare 1,287,674 output cells between
the companion engines without differing bits or absence. This includes secondary
lines, bands, displaced outputs, event columns and explicitly identified table
carriers. Calendar fixtures separately check 86,866 table cells. Event tests
distinguish confirmation indices from plotted origin indices, so a backdated
marker cannot conceal premature availability.

The companion release gates also pass all 116 scalar and stateful numerical
signatures: 6,836 cases and 1,504,908 accepted calls. Independent field shocks,
declared defaults, changing lengths, checkpoint restoration and replay are
included. Power, trigonometry, exponential, logarithmic and hypotenuse kernels
have independent rounding evidence. Fresh installed distributions run 363
compiled programs, with 124,977 exact cross-engine cells and 6,756 independently
expected cells. These finite corpora are not a proof of every possible history.

The same installed-program and independent-oracle checks pass using downloaded
public 0.7.0 distributions. All 1,617 package files, 108 wheel modules and 181
source-distribution files match the immutable source or the verified generated
build. Registry integrity and attestation subject, source and workflow claims
match; cryptographic signatures and transparency inclusion were not verified.

After the RSI correction, 197 outputs differ in at least one exercised case,
38 agree on the sampled finite inputs and 27 are
constant outputs. Two outputs carry tables, and two event columns that are
absent in broad fixtures have separate finite, independently derived fixtures.
Differences include arithmetic order, gaps and documented algorithm choices;
the count does not mean every difference is a calculation defect. Neither a
relative tolerance nor two identically absent outputs establishes agreement.

## Confirmed boundary corrections

Balance of Power now omits nonfinite numerators, ranges and ratios while
preserving finite ordinary results and recovery on the following bar.

WaveTrend computes its signal mean from the chronological window. An incremental
sum previously drifted enough to create a false crossing on a simple rising
series. AlphaTrend's private mean and flow sums use the same fresh-window
principle so an expired infinite contribution cannot poison all later values.
This costs work proportional to bars times period. On the recorded machine,
20,000 bars at AlphaTrend period 500 take a median 32.42 ms rather than 3.62 ms;
WaveTrend with signal length 100 takes 8.58 ms rather than 4.81 ms. These are
observations, not new timing guarantees or raised engine performance budgets.

Seasonality excludes nonfinite month returns from the table and its counts.
Aggregate means or deviations that overflow remain blank. Finite return order,
ignored-month behavior and the still-forming month are unchanged. Table tests
scan headers, body and summary for nonfinite display text.

The composition audit also found overflow boundaries in companion TSI, RSI,
Ultimate Oscillator, MFI, CCI and correlation. Their corrections are verified in
both language runtimes, including compiled historical and forming updates.

Native RSI now treats a missing or overflowing change as unavailable, retaining
any already-seeded gain and loss averages. Unseeded legs independently seek a
complete finite suffix and finite mean. Running arithmetic overflow retains its
state and stays unavailable, instead of silently restarting or emitting zero or
100. Ordinary finite arithmetic and the function signature are unchanged.
All five built-in consumer paths and `rsiSeries` inherit the corrected behavior.
Six actual compiled fixtures agree bit-for-bit with both companion engines.
On the recorded machine, an ordinary 20,000-bar run changes from 0.12 to 0.23 ms.
Repeated failed seeds can require fresh period-length sums before recovery.

The built package passes 21 numerical browser cases across three engines,
including ordinary directional and Hull values, RSI recovery, absent Balance
of Power points, WaveTrend crossing markers, AlphaTrend recovery and finite
Seasonality table pixels. Screenshots were inspected.

## Remaining contract distinctions

Known distinctions include:

- Bandwidth and historical volatility use percentage display units in the chart;
  the corresponding language readings are ratios and require multiplication by
  100 in the compared expression.
- The native parabolic stop clamps against previous price ranges. The existing
  language call explicitly specifies an unclamped recurrence. Matching its name
  and parameters alone does not make those algorithms equivalent.
- Several native recursive studies remain unavailable after an interior source
  hole, while the language recurrences preserve their prior state and resume.
- Native extrema, zero-denominator handling and missing-volume defaults can
  change availability even when complete, ordinary inputs agree.

These remain open audit items. The wider comparison does not replace the
independently derived Hull and directional fixtures above or establish complete
numerical coverage.
