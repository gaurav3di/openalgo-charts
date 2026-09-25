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

The companion audit has additionally reproduced changing-length, volume-anchor,
overflow and partial-output disagreements. Its fixes and release gates are tracked
in that repository. Both companion packages are authorized for 0.7.0 only after
their numerical audit and distribution checks; the chart release remains 2.5.4.
