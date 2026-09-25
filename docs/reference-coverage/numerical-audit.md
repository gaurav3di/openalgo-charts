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
budgets pass. The indicator tier measures 36.00 kB Brotli and all tiers together
289.25 kB on this development build.

The companion audit has additionally reproduced changing-length, volume-anchor,
overflow and partial-output disagreements. Its fixes and release gates are tracked
in that repository. Both companion packages are authorized for 0.7.0 only after
their numerical audit and distribution checks; the chart release remains 2.5.4.
