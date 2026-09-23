import React from 'react';
import Link from 'next/link';
import BtcUsdChart from './BtcUsdChart';

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`oac-reveal ${className}`}>{children}</div>;
}

export function Hero() {
  return (
    <section className="oac-hero" aria-labelledby="hero-title">
      <div className="oac-hero__copy">
        <div className="oac-eyebrow oac-intro oac-intro--eyebrow"><span className="oac-status-dot" /> THE OPENALGO CHARTING EXPERIENCE</div>
        <h1 id="hero-title" className="oac-hero__title">
          <span className="oac-title-line"><span className="oac-intro oac-intro--title">Every move.</span></span>
          <span className="oac-title-line"><span className="oac-intro oac-intro--gradient oac-gradient-text">A clearer view.</span></span>
        </h1>
        <p className="oac-hero__sub oac-intro oac-intro--sub">
          Go from watching the market to exploring it.<br className="oac-desktop-break" /> Beautiful charts. Powerful tools. A perspective that&rsquo;s yours.
        </p>
        <div className="oac-actions oac-intro oac-intro--actions">
          <a className="oac-action oac-action--primary" href="#playground">Try the live chart <Arrow /></a>
          <a className="oac-action oac-action--secondary" href="#possibilities">Explore the possibilities <Arrow diagonal /></a>
        </div>
      </div>
      <BtcUsdChart />
      <div className="oac-capability-strip" aria-label="Chart capabilities">
        <span>More ways to see the market</span>
        <div><strong>15</strong> chart styles</div>
        <div><strong>105</strong> indicators</div>
        <div><strong>87</strong> drawing tools</div>
      </div>
    </section>
  );
}

type MiniBar = readonly [open: number, high: number, low: number, close: number];

const INDICATOR_BARS: readonly MiniBar[] = [
  [96, 99, 94, 98], [98, 100, 95, 97], [97, 101, 96, 100], [100, 102, 97, 99],
  [99, 103, 98, 101], [101, 104, 99, 100], [100, 102, 96, 97], [97, 100, 95, 99],
  [99, 104, 98, 103], [103, 106, 101, 105], [105, 107, 102, 104], [104, 109, 103, 108],
  [108, 111, 106, 110], [110, 112, 107, 109], [109, 114, 108, 113], [113, 117, 111, 116],
  [116, 118, 112, 114], [114, 117, 111, 115],
];
const EMA_VALUES = [96, 97, 98, 99, 99, 99, 99, 99, 100, 101, 102, 103, 104, 105, 106, 108, 109, 110];
const RSI_VALUES = [48, 52, 46, 54, 50, 47, 38, 44, 55, 62, 59, 68, 70, 63, 71, 76, 64, 68];
const DRAWING_BARS: readonly MiniBar[] = [
  [94, 98, 91, 96], [96, 99, 93, 95], [95, 100, 94, 98], [98, 101, 96, 100],
  [100, 103, 98, 99], [99, 103, 97, 102], [102, 105, 100, 104], [104, 107, 101, 102],
  [102, 108, 100, 106], [106, 109, 103, 107], [107, 110, 104, 105], [105, 111, 104, 109],
  [109, 112, 106, 108], [108, 115, 107, 113], [113, 116, 110, 112], [112, 117, 110, 115],
  [115, 118, 112, 114], [114, 119, 111, 117],
];

function miniPriceY(price: number): number { return 116 - (price - 90) * 3; }
function miniPath(values: readonly number[], y: (value: number) => number): string {
  return values.map((value, index) => `${index === 0 ? 'M' : 'L'}${18 + index * 18} ${y(value).toFixed(1)}`).join(' ');
}
function MiniCandles({ bars, muted = false }: { bars: readonly MiniBar[]; muted?: boolean }) {
  return <g opacity={muted ? 0.7 : 1}>{bars.map(([open, high, low, close], index) => {
    const x = 18 + index * 18;
    const top = Math.min(miniPriceY(open), miniPriceY(close));
    const color = close >= open ? '#31a99e' : '#e66c66';
    return <g key={index} fill={color} stroke={color}>
      <line x1={x} y1={miniPriceY(high)} x2={x} y2={miniPriceY(low)} strokeWidth="1.25" />
      <rect x={x - 3.5} y={top} width="7" height={Math.max(2, Math.abs(miniPriceY(open) - miniPriceY(close)))} strokeWidth="0" />
    </g>;
  })}</g>;
}

function FeatureArt({ type }: { type: 'indicators' | 'drawings' | 'views' }) {
  if (type === 'indicators') return (
    <div className="oac-feature-art oac-feature-art--indicators" aria-hidden="true">
      <span className="oac-art-label">PRICE / INDICATOR STUDY</span>
      <svg viewBox="0 0 360 175" fill="none">
        <path className="oac-art-grid" d="M0 28H360M0 72H360M0 116H360M0 143H360M72 0V175M144 0V175M216 0V175M288 0V175" />
        <MiniCandles bars={INDICATOR_BARS} />
        <path d={miniPath(EMA_VALUES, miniPriceY)} stroke="#d4ac63" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="0" y1="122" x2="360" y2="122" stroke="var(--oac-card-border)" />
        <path d={miniPath(RSI_VALUES, value => 159 - (value - 30) * .62)} stroke="var(--oac-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <text x="300" y="17" fill="#d4ac63" fontSize="9" fontWeight="700">EMA 20</text>
        <text x="18" y="138" fill="var(--oac-muted)" fontSize="9" fontWeight="700">RSI 14</text>
      </svg>
      <span className="oac-art-tag"><i /> Overlay + lower study</span>
    </div>
  );
  if (type === 'drawings') return (
    <div className="oac-feature-art oac-feature-art--drawings" aria-hidden="true">
      <span className="oac-art-label">DRAWING / SELECTED CHANNEL</span>
      <svg viewBox="0 0 360 175" fill="none">
        <path className="oac-art-grid" d="M0 28H360M0 72H360M0 116H360M72 0V175M144 0V175M216 0V175M288 0V175" />
        <MiniCandles bars={DRAWING_BARS} muted />
        <path d="M35 100 330 44 330 71 35 127Z" fill="var(--oac-text)" opacity=".085" />
        <path d="M35 100 330 44M35 127 330 71" stroke="var(--oac-text)" strokeWidth="2" strokeLinecap="round" />
        <path d="M35 114 330 58" stroke="#d4ac63" strokeWidth="1.4" strokeDasharray="5 5" opacity=".9" />
        <circle cx="35" cy="100" r="5" fill="var(--oac-card)" stroke="var(--oac-text)" strokeWidth="2" />
        <circle cx="330" cy="44" r="5" fill="var(--oac-card)" stroke="var(--oac-text)" strokeWidth="2" />
        <circle cx="35" cy="127" r="5" fill="var(--oac-card)" stroke="var(--oac-text)" strokeWidth="2" />
        <circle cx="330" cy="71" r="5" fill="var(--oac-card)" stroke="var(--oac-text)" strokeWidth="2" />
        <path d="m249 75 3 20 4-7 7-3Z" fill="var(--oac-text)" stroke="var(--oac-card)" strokeWidth="2" />
        <text x="39" y="152" fill="var(--oac-muted)" fontSize="9" fontWeight="700">2 PARALLEL BOUNDARIES</text>
      </svg>
      <span className="oac-art-tag"><i /> Selected channel · drag handles</span>
    </div>
  );
  return (
    <div className="oac-feature-art oac-feature-art--views" aria-hidden="true">
      <span className="oac-art-label">A different angle changes everything.</span>
      <div className="oac-art-views">
        <div className="oac-art-view oac-art-view--candles"><span>Candles</span><svg viewBox="0 0 110 96" fill="none"><path d="M15 43V86M36 35V73M57 40V78M78 15V57M99 3V43" stroke="var(--oac-accent-2)" /><path d="M15 52V76M36 42V65M57 49V68M78 24V46M99 13V33" stroke="var(--oac-accent-2)" strokeWidth="7" /></svg></div>
        <div className="oac-art-view oac-art-view--line"><span>Line</span><svg viewBox="0 0 110 96" fill="none"><path d="M0 80 15 70 25 74 39 49 49 59 62 33 75 41 86 19 97 25 110 7" stroke="var(--oac-accent)" strokeWidth="2" /></svg></div>
        <div className="oac-art-view oac-art-view--area"><span>Area</span><svg viewBox="0 0 110 96" fill="none"><path d="M0 80 15 70 25 74 39 49 49 59 62 33 75 41 86 19 97 25 110 7V96H0Z" fill="var(--oac-accent)" opacity=".15" /><path d="M0 80 15 70 25 74 39 49 49 59 62 33 75 41 86 19 97 25 110 7" stroke="var(--oac-accent)" strokeWidth="2" /></svg></div>
      </div>
      <span className="oac-art-tag">Find a view that speaks to you</span>
    </div>
  );
}

export function Features() {
  return (
    <section id="possibilities" className="oac-section oac-possibilities" aria-labelledby="possibilities-title">
      <Reveal className="oac-section-heading">
        <span className="oac-eyebrow">BUILT FOR YOUR CURIOSITY</span>
        <h2 id="possibilities-title">There&rsquo;s more to<br /><span className="oac-text-muted">every market move.</span></h2>
        <p>Follow the trend. Connect the dots. See what you couldn&rsquo;t see before.</p>
      </Reveal>
      <div className="oac-features">
        <Reveal className="oac-feature">
          <FeatureArt type="indicators" />
          <div className="oac-feature__copy"><span className="oac-feature__index">01 / DISCOVER</span><h3>Look beneath the surface.</h3><p>Bring price, momentum, and volatility into focus with 105 indicators. Layer your favorites and explore the bigger picture.</p><Link href="/examples#custom-indicators" className="oac-text-link">Explore indicators <Arrow /></Link></div>
        </Reveal>
        <Reveal className="oac-feature">
          <FeatureArt type="drawings" />
          <div className="oac-feature__copy"><span className="oac-feature__index">02 / EXPRESS</span><h3>Give your ideas a shape.</h3><p>Mark a level. Map a scenario. Tell the story you see with 87 drawing tools that put your thinking right on the chart.</p><Link href="/examples#drawing-tools" className="oac-text-link">Try the drawing tools <Arrow /></Link></div>
        </Reveal>
        <Reveal className="oac-feature">
          <FeatureArt type="views" />
          <div className="oac-feature__copy"><span className="oac-feature__index">03 / MAKE IT YOURS</span><h3>A fresh perspective, instantly.</h3><p>From the detail of candlesticks to the simplicity of a line. Find your rhythm with 15 chart styles and a look that feels like you.</p><Link href="/examples#interactive" className="oac-text-link">Find your view <Arrow /></Link></div>
        </Reveal>
      </div>
    </section>
  );
}

export function WhyOpenSource() {
  return (
    <>
      <section className="oac-section oac-freedom" aria-labelledby="freedom-title">
        <Reveal className="oac-freedom__copy">
          <span className="oac-eyebrow">YOUR CHARTS. YOUR RULES.</span>
          <h2 id="freedom-title">Made to be<br /><span className="oac-gradient-text">made your own.</span></h2>
          <p>Your style. Your workflow. Your next big idea. OpenAlgo Charts gives you the freedom to create a charting experience that feels entirely yours.</p>
          <Link href="/examples" className="oac-text-link">See what&rsquo;s possible <Arrow diagonal /></Link>
        </Reveal>
        <Reveal className="oac-freedom__details">
          <div><span className="oac-freedom__icon" aria-hidden="true">✦</span><div><h3>Every detail, considered.</h3><p>Thoughtful tools, fluid interaction, and room to focus on what matters to you.</p></div></div>
          <div><span className="oac-freedom__icon" aria-hidden="true">◐</span><div><h3>At home in your world.</h3><p>Light or dark. A single chart or a complete workspace. Shape it around the way you work.</p></div></div>
          <div><span className="oac-freedom__icon" aria-hidden="true">↗</span><div><h3>Open from the start.</h3><p>Free to use, explore, and extend. Built in the open, for a community that keeps moving.</p></div></div>
        </Reveal>
      </section>
      <section className="oac-section oac-closing" aria-labelledby="closing-title">
        <Reveal>
          <span className="oac-eyebrow">A CHART IS JUST THE BEGINNING</span>
          <h2 id="closing-title">What will you see next?</h2>
          <p>Your next perspective is a click away.</p>
          <div className="oac-actions"><a href="#playground" className="oac-action oac-action--primary">Make your first move <Arrow /></a><Link href="/docs/getting-started" className="oac-action oac-action--secondary">Start creating <Arrow diagonal /></Link></div>
          <span className="oac-closing__wordmark" aria-hidden="true">OpenAlgo</span>
        </Reveal>
      </section>
    </>
  );
}
