"use client";

/**
 * Web proposal — the interactive, scroll-driven version of the proposal PDF.
 * See docs/proposal-web-CONTEXT.md (D1–D8). Copy comes from
 * lib/proposal-content.ts (shared with the PDF); everything client-specific
 * merges in from the quote + scope. The page ends on the live quote with the
 * existing Accept/Decline flow (QuoteResponseView) — the sticky respond bar
 * stays offstage until the customer reaches the quotation section.
 *
 * v3 "alive" pass (huly.io-inspired): the whole story runs on a dark canvas
 * with an ambient constellation network drawn behind every section (drifting
 * nodes + connecting lines — one interconnected system, literally), sweeping
 * light beams, periodic comet streaks, a cursor spotlight and gradient
 * shimmer through the display type. All hand-rolled: one <canvas>, one rAF
 * scroll driver, IntersectionObservers and CSS — no animation libraries.
 *
 * Motion policy: ambient self-contained animation (canvas, beams, shimmer,
 * marquee) runs for everyone — many Windows machines report reduced-motion
 * via "Animation effects: off" without the user choosing it, and a frozen
 * background reads as broken. SCROLL-COUPLED motion (inertia scroll, hero
 * parallax, watermark drift, staged reveals) still honours
 * prefers-reduced-motion. The quote section's opaque paper background covers
 * the ambient layers — they are never faded, so scrolling back up from the
 * quote returns to a fully alive story.
 */

import { useEffect, useRef, useState } from "react";
import type { ScopeDocument } from "@/lib/quote-engine";
import { QuoteResponseView } from "@/app/quote-response/[token]/response-view";
import {
  COMPANY,
  WHO_WE_ARE,
  DIFFERENTIATORS,
  SUPPORT_CARDS,
  NBN_PLANS,
  OFFERINGS,
  TESTIMONIALS,
} from "@/lib/proposal-content";

interface Props {
  token: string;
  quoteId: string;
  quoteRef: string;
  quoteStatus: string;
  isProgress: boolean;
  clientName: string;
  siteName: string | null;
  siteAddress: string | null;
  createdAt: string;
  pricing: {
    totalExGST: number;
    totalIncGST: number;
    gst: number;
    fullPriceExGST?: number;
    discount?: { percent: number; amount: number };
    pp1?: { total: number };
    pp2?: { total: number };
  };
  scope: ScopeDocument;
}

const NAV_SECTIONS = [
  { id: "top", label: "Top" },
  { id: "story", label: "Track record" },
  { id: "who", label: "Who we are" },
  { id: "why", label: "Why Centrefit" },
  { id: "support", label: "Support" },
  { id: "connectivity", label: "Internet" },
  { id: "clients", label: "Clients" },
  { id: "quote", label: "Your quote" },
];

// ── Ambient constellation canvas ───────────────────────────────────────────
// Fixed full-viewport canvas behind the story: slow-drifting nodes joined by
// distance-faded lines. Density scales with viewport area (capped), DPR is
// capped at 2, and the loop pauses when the tab is hidden.

type CNode = { x: number; y: number; vx: number; vy: number; r: number };

function ConstellationCanvas({ lite }: { lite: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Nodes live outside the effect so a lite-mode flip trims the field
  // in place — survivors keep drifting from where they are, no jump.
  const nodesRef = useRef<CNode[]>([]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Deliberately NOT gated on prefers-reduced-motion: many Windows machines
    // report it via "Animation effects: off" without the user ever choosing
    // it, and a frozen background reads as broken. The ambient drift is slow
    // and dim; the scroll-coupled motion (parallax, inertia, drift) is what
    // stays disabled for reduced-motion users.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let running = true;
    let lastDraw = 0;
    // Lite: half the nodes, DPR 1, 30fps — the layer stays alive but stops
    // costing anything a weak GPU notices.
    const frameGap = lite ? 33 : 0;

    const seed = () => {
      const cap = lite ? 45 : 80;
      const count = Math.max(26, Math.min(cap, Math.round((w * h) / (lite ? 32000 : 16000))));
      const nodes = nodesRef.current;
      if (nodes.length > count) nodes.length = count;
      while (nodes.length < count) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          r: 0.8 + Math.random() * 1.2,
        });
      }
    };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const LINK = 130;
    const LINK2 = LINK * LINK;
    // Lines are batched into a handful of alpha buckets — one stroke() per
    // bucket instead of one per pair (hundreds of draw calls → ≤6).
    const BUCKETS = 6;
    const segs: number[][] = Array.from({ length: BUCKETS }, () => []);

    const step = (t: number) => {
      if (!running) return;
      raf = requestAnimationFrame(step);
      if (t - lastDraw < frameGap) return;
      lastDraw = t;
      const nodes = nodesRef.current;
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -20) n.x = w + 20;
        if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        if (n.y > h + 20) n.y = -20;
      }
      for (const s of segs) s.length = 0;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK2) {
            const d = Math.sqrt(d2);
            const b = Math.min(BUCKETS - 1, Math.floor((1 - d / LINK) * BUCKETS));
            segs[b].push(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y);
          }
        }
      }
      ctx.lineWidth = 1;
      for (let b = 0; b < BUCKETS; b++) {
        const s = segs[b];
        if (!s.length) continue;
        const a = (((b + 0.5) / BUCKETS) * 0.34).toFixed(3);
        ctx.strokeStyle = `rgba(96,165,250,${a})`;
        ctx.beginPath();
        for (let k = 0; k < s.length; k += 4) {
          ctx.moveTo(s[k], s[k + 1]);
          ctx.lineTo(s[k + 2], s[k + 3]);
        }
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(148,163,184,0.75)";
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(step);
      }
    };

    resize();
    raf = requestAnimationFrame(step);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [lite]);

  return <canvas ref={ref} className="cfp-canvas" aria-hidden="true" />;
}

// ── Split-word display headings ────────────────────────────────────────────
// Each word sits in an overflow-hidden slot and rises into place with a
// stagger when the heading's reveal fires — the editorial text treatment.

function SplitWords({ text }: { text: string }) {
  return (
    <h2 className="cfp-h2" data-reveal="split" aria-label={text}>
      {text.split(" ").map((w, i) => (
        <span key={i} className="cfp-w" aria-hidden="true">
          <span className="cfp-wi" style={{ transitionDelay: `${i * 0.055}s` }}>{w}</span>
        </span>
      ))}
    </h2>
  );
}

// ── Marquee band ───────────────────────────────────────────────────────────

const MARQUEE_ITEMS = [
  "Security",
  "CCTV",
  "Access Control",
  "Data & Wi-Fi",
  "Audio",
  "Business Internet",
  "24/7 Monitoring",
];

function Marquee({ reverse = false }: { reverse?: boolean }) {
  return (
    <div className="cfp-marquee" aria-hidden="true">
      <div className={`cfp-marquee-track${reverse ? " cfp-marquee-reverse" : ""}`}>
        {[0, 1].map((k) => (
          <div className="cfp-marquee-seg" key={k}>
            {MARQUEE_ITEMS.map((m) => (
              <span key={m} className="cfp-marquee-item">
                {m}
                <span className="cfp-marquee-dot">·</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat counter ───────────────────────────────────────────────────────────

function StatCounter({ value, label }: { value: string; label: string }) {
  const m = value.match(/^(\d+)(.*)$/);
  const target = m ? parseInt(m[1], 10) : null;
  const suffix = m ? m[2] : "";
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (target === null) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || started.current) return;
        started.current = true;
        io.disconnect();
        const t0 = performance.now();
        const dur = 1500;
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / dur);
          setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return (
    <div className="cfp-stat" ref={ref} data-reveal="zoom">
      <span className="cfp-stat-n">{target === null ? value : `${n}${suffix}`}</span>
      <span className="cfp-stat-label">{label}</span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function ProposalView(props: Props) {
  const { quoteRef, clientName, siteName, siteAddress, createdAt, scope, token } = props;
  const systems = scope.systems.map((s) => s.name);
  const dateStr = new Date(createdAt).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState("top");

  // Perf governor — one-way downgrade to "lite" ambience when the machine
  // can't hold ~35fps (office PCs on integrated graphics). Lite keeps the
  // full story and reveals but drops the layers weak GPUs pay for every
  // frame: backdrop blur, comets, spotlight, inertia scroll, canvas density.
  const [lite, setLite] = useState(false);
  const liteRef = useRef(false);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let slow = 0;
    let last = 0;
    const tick = (t: number) => {
      if (last) {
        const dt = t - last;
        // ignore tab-hidden / stall gaps — they aren't render frames
        if (dt < 250) {
          frames++;
          if (dt > 28.5) slow++;
          if (frames >= 120) {
            if (slow / frames > 0.4) setLite(true);
            last = t;
            return;
          }
        }
      }
      last = t;
      raf = requestAnimationFrame(tick);
    };
    // wait out the hero entrance so we measure steady-state, not the intro
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, 1800);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);
  useEffect(() => {
    liteRef.current = lite;
    if (lite && rootRef.current) {
      // park the watermark drift wherever it was — the frame loop stops
      // updating it in lite mode
      rootRef.current
        .querySelectorAll<HTMLElement>("[data-drift]")
        .forEach((el) => {
          el.style.transform = "";
        });
    }
  }, [lite]);

  // One effect wires the journey: reveal observers, the rAF scroll driver
  // (page progress, hero parallax, watermark drift), the cursor spotlight
  // and the dot-nav active-section tracker.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    // 1. Reveal-on-scroll — runs for everyone. One-shot, short, contained
    // transitions aren't the motion that bothers vestibular-sensitive users,
    // and Windows machines report reduced-motion via "Animation effects:
    // off" without the user ever choosing it (Edge/Chrome follow that
    // toggle; Firefox doesn't — which made the same page look different
    // per browser). Only CONTINUOUS scroll-coupled motion honours the flag.
    const revealEls = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("cfp-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -36px 0px" },
    );
    revealEls.forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());

    // 2. Scroll driver. The progress bar is a position indicator (tracks the
    // user's own scrolling 1:1) and runs for everyone; hero parallax and
    // watermark drift are the continuous scroll-coupled layers and stay
    // static under reduced motion.
    const hero = root.querySelector<HTMLElement>(".cfp-hero");
    const driftEls = Array.from(root.querySelectorAll<HTMLElement>("[data-drift]"));
    {
      let ticking = false;
      const frame = () => {
        ticking = false;
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const pageP = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        root.style.setProperty("--pageP", String(pageP));
        if (reduced) return;
        if (hero) {
          const sp = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9)));
          hero.style.setProperty("--sp", String(sp));
        }
        if (liteRef.current) return;
        const vh = window.innerHeight;
        for (const el of driftEls) {
          const r = el.getBoundingClientRect();
          const progress = (r.top + r.height / 2 - vh / 2) / vh; // ~ -1 … 1
          const f = parseFloat(el.dataset.drift || "0.1");
          el.style.transform = `translate3d(0, ${(progress * f * 320).toFixed(1)}px, 0)`;
        }
      };
      const onScroll = () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(frame);
        }
      };
      frame();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      cleanups.push(() => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      });
    }

    // 3. Cursor spotlight (fine pointers only).
    if (!reduced && window.matchMedia("(pointer: fine)").matches) {
      const spot = root.querySelector<HTMLElement>(".cfp-spotlight");
      if (spot) {
        let raf = 0;
        const onMove = (e: PointerEvent) => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            spot.style.setProperty("--mx", `${e.clientX}px`);
            spot.style.setProperty("--my", `${e.clientY}px`);
          });
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        cleanups.push(() => {
          window.removeEventListener("pointermove", onMove);
          cancelAnimationFrame(raf);
        });
      }
    }

    // 4. Dot-nav active section.
    const sections = NAV_SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    const navIo = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveSection(e.target.id);
        }
      },
      { rootMargin: "-42% 0px -42% 0px" },
    );
    sections.forEach((el) => navIo.observe(el));
    cleanups.push(() => navIo.disconnect());

    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Inertia wheel scroll (desktop fine pointers). Lerps native scrollTo
  // rather than transform-hijacking the page, so every fixed/sticky element
  // (progress bar, dots, the quote's respond bar, modals) keeps working
  // untouched. Horizontal trackpad gestures, pinch zoom and line-mode wheels
  // stay fully native. Its own effect so a lite-mode flip unhooks the
  // non-passive wheel listener entirely — native threaded scrolling comes
  // back, which is what a struggling machine actually wants.
  useEffect(() => {
    if (lite) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !window.matchMedia("(pointer: fine)").matches) return;
    let target = 0;
    let current = 0;
    let raf = 0;
    let active = false;
    let lastT = 0;
    const loop = (t: number) => {
      // Frame-rate-independent lerp: same catch-up per real second whether
      // the machine renders 30 or 144 frames of it (0.9^(dt/16.7) ≈ the old
      // 0.1-per-60Hz-frame feel).
      const dt = lastT ? Math.min(t - lastT, 100) : 16.7;
      lastT = t;
      current += (target - current) * (1 - Math.pow(0.9, dt / 16.7));
      if (Math.abs(target - current) < 0.6) {
        current = target;
        active = false;
      }
      // behavior:"instant" is load-bearing — the page sets CSS
      // scroll-behavior:smooth, and a bare scrollTo(x, y) honours it,
      // restarting a browser smooth-scroll animation every frame. That
      // compounding made scrolling crawl on slower machines.
      window.scrollTo({ top: current, behavior: "instant" });
      if (active) raf = requestAnimationFrame(loop);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      if (e.deltaMode !== 0) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (!active) {
        target = window.scrollY;
        current = window.scrollY;
      }
      target += e.deltaY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      target = Math.max(0, Math.min(target, max));
      if (!active) {
        active = true;
        lastT = 0;
        raf = requestAnimationFrame(loop);
      }
    };
    const onNativeScroll = () => {
      if (!active) {
        target = window.scrollY;
        current = window.scrollY;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onNativeScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onNativeScroll);
      cancelAnimationFrame(raf);
    };
  }, [lite]);

  // The quote's sticky Accept/Decline bar slides in only once the customer
  // reaches the quotation section; the ambient layers fade out at the same
  // moment so the document reads like clean paper.
  const quoteRefEl = useRef<HTMLDivElement>(null);
  const [quoteReached, setQuoteReached] = useState(false);
  useEffect(() => {
    const el = quoteRefEl.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setQuoteReached(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={`cfp-root${quoteReached ? " cfp-arrived" : ""}${lite ? " cfp-lite" : ""}`}
      ref={rootRef}
    >
      <style>{CSS}</style>

      {/* Ambient layers — behind everything, fade out at the quote */}
      <ConstellationCanvas lite={lite} />
      <div className="cfp-spotlight" aria-hidden="true" />

      {/* Scroll progress bar */}
      <div className="cfp-progress" aria-hidden="true" />

      {/* Desktop dot navigation */}
      <nav className="cfp-dots" aria-label="Proposal sections">
        {NAV_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`cfp-dot${activeSection === s.id ? " cfp-dot-active" : ""}`}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" })}
            aria-label={s.label}
          >
            <span className="cfp-dot-label">{s.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Hero ── */}
      <header className="cfp-hero" id="top">
        <div className="cfp-beams" aria-hidden="true">
          <div className="cfp-beam" />
          <div className="cfp-beam cfp-beam2" />
          <div className="cfp-comet" />
          <div className="cfp-comet cfp-comet2" />
        </div>

        <div className="cfp-hero-bar">
          <div className="cfp-container cfp-hero-bar-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/centrefit-logo-white.png" alt="Centrefit Group" className="cfp-hero-logo" />
            <div className="cfp-hero-meta">
              <span className="cfp-hero-ref">{quoteRef}</span>
              <span className="cfp-hero-date">{dateStr}</span>
            </div>
          </div>
        </div>

        <div className="cfp-hero-body">
          <div className="cfp-container cfp-hero-inner">
            <p className="cfp-kicker cfp-hero-item" style={{ animationDelay: "0.05s" }}>
              PROJECT PROPOSAL
            </p>
            <h1 className="cfp-hero-title cfp-hero-item" style={{ animationDelay: "0.18s" }}>
              <span className="cfp-shimmer">{clientName}</span>
              {siteName && <span className="cfp-hero-site">{siteName}</span>}
            </h1>
            {siteAddress && (
              <p className="cfp-hero-address cfp-hero-item" style={{ animationDelay: "0.34s" }}>
                {siteAddress}
              </p>
            )}
            <div className="cfp-hero-rule cfp-hero-item" style={{ animationDelay: "0.44s" }} />
            <p className="cfp-hero-lead cfp-hero-item" style={{ animationDelay: "0.52s" }}>
              A complete technology fit-out — designed, installed, commissioned and supported by
              one team.
            </p>
            {systems.length > 0 && (
              <div className="cfp-chips">
                {systems.map((name, i) => (
                  <span
                    key={name}
                    className="cfp-chip cfp-hero-item"
                    style={{ animationDelay: `${0.66 + i * 0.07}s` }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <a href="#story" className="cfp-scroll-cue cfp-hero-item" style={{ animationDelay: "1s" }} aria-label="Scroll to proposal">
          <span className="cfp-scroll-cue-text">The story</span>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </a>
      </header>

      {/* ── Stats ── */}
      <section className="cfp-stats" id="story">
        <div className="cfp-container cfp-stats-grid">
          {COMPANY.stats.map((st) => (
            <StatCounter key={st.label} value={st.n} label={st.label} />
          ))}
        </div>
      </section>

      {/* ── Statement ── */}
      <section className="cfp-statement">
        <div className="cfp-container">
          <p className="cfp-statement-line" data-reveal>One team.</p>
          <p className="cfp-statement-line cfp-statement-outline" data-reveal style={{ transitionDelay: ".14s" }}>
            End to end.
          </p>
          <p className="cfp-statement-line" data-reveal style={{ transitionDelay: ".28s" }}>
            <span className="cfp-shimmer">Around the clock.</span>
          </p>
        </div>
      </section>

      <Marquee />

      {/* ── Who we are ── */}
      <section className="cfp-section" id="who">
        <div className="cfp-wm" aria-hidden="true"><span className="cfp-watermark" data-drift="0.09">01</span></div>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>WHO WE ARE</p>
          <SplitWords text="Technology for spaces where people gather." />
          {WHO_WE_ARE.map((p, i) => (
            <p key={i} className="cfp-para" data-reveal style={{ transitionDelay: `${0.08 * (i + 1)}s` }}>
              {p}
            </p>
          ))}

          <p className="cfp-sublabel" data-reveal>WHO WE&apos;VE BUILT FOR</p>
          <div className="cfp-brands">
            {COMPANY.brands.map((b, i) => (
              <div key={b.name} className="cfp-brand cfp-glass" data-reveal="zoom" style={{ transitionDelay: `${0.07 * i}s` }}>
                <span className="cfp-brand-name">{b.name}</span>
                <span className="cfp-brand-count">{b.count}</span>
              </div>
            ))}
          </div>

          <div className="cfp-award" data-reveal="zoom">
            <div>
              <p className="cfp-award-kicker">AWARDED</p>
              <p className="cfp-award-title">{COMPANY.award}</p>
            </div>
            <p className="cfp-award-licences">{COMPANY.licences}</p>
          </div>
        </div>
      </section>

      {/* ── Differentiators ── */}
      <section className="cfp-section" id="why">
        <div className="cfp-wm" aria-hidden="true"><span className="cfp-watermark" data-drift="0.11">02</span></div>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>WHY CENTREFIT</p>
          <SplitWords text="What we do differently." />
          <p className="cfp-para" data-reveal>Keep scrolling — each one stacks on the last.</p>
          <div className="cfp-stack">
            {DIFFERENTIATORS.map((d, i) => (
              <div
                key={d.title}
                className="cfp-stack-card"
                style={{ top: `calc(clamp(72px, 11vh, 110px) + ${i * 18}px)` }}
              >
                <span className="cfp-diff-num">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="cfp-diff-title">{d.title}</h3>
                  <p className="cfp-diff-body">{d.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Support ── */}
      <section className="cfp-section" id="support">
        <div className="cfp-wm" aria-hidden="true"><span className="cfp-watermark" data-drift="0.09">03</span></div>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>AFTER THE INSTALL</p>
          <SplitWords text="Support that doesn't clock off." />
          <p className="cfp-para" data-reveal>
            The installation is where most contractors finish. It&apos;s where we start — every
            Centrefit site is backed by the team that built it.
          </p>
          <div className="cfp-cards">
            {SUPPORT_CARDS.map((c, i) => (
              <div key={c.title} className="cfp-card cfp-glass" data-reveal="zoom" style={{ transitionDelay: `${0.09 * i}s` }}>
                <h3 className="cfp-card-title">{c.title}</h3>
                <p className="cfp-card-body">{c.body}</p>
              </div>
            ))}
          </div>

          <p className="cfp-kicker" style={{ marginTop: "64px" }} data-reveal>BEYOND THIS PROPOSAL</p>
          <h3 className="cfp-h3" data-reveal>One relationship, the whole stack.</h3>
          <div className="cfp-pills">
            {OFFERINGS.map((o, i) => (
              <div key={o.name} className="cfp-pill cfp-glass" data-reveal="zoom" style={{ transitionDelay: `${0.05 * i}s` }}>
                <span className="cfp-pill-name">{o.name}</span>
                <span className="cfp-pill-desc">{o.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NBN ── */}
      <section className="cfp-section cfp-glow" id="connectivity">
        <div className="cfp-wm" aria-hidden="true"><span className="cfp-watermark" data-drift="0.11">04</span></div>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>CONNECTIVITY</p>
          <SplitWords text="Business internet, managed by us." />
          <p className="cfp-para" data-reveal>
            We&apos;re an internet provider as well as an integrator — one team for the connection,
            the network and everything running on it. Every plan is business-grade NBN with no
            lock-in and no setup fee, supported in Australia by the people who built your site.
          </p>
          <div className="cfp-nbn">
            {NBN_PLANS.map((p, i) => (
              <div key={p.name} className="cfp-nbn-row cfp-glass" data-reveal={i % 2 === 0 ? "left" : "right"} style={{ transitionDelay: `${0.05 * i}s` }}>
                <div className="cfp-nbn-plan">
                  <span className="cfp-nbn-name">{p.name}</span>
                  <span className="cfp-nbn-fit">{p.fit}</span>
                </div>
                <div className="cfp-nbn-speed">
                  <span className="cfp-nbn-mbps">{p.speed} Mbps</span>
                  <span className="cfp-nbn-evening">Typical evening {p.evening} Mbps</span>
                </div>
                <div className="cfp-nbn-price">
                  <span className="cfp-nbn-dollars">{p.price}</span>
                  <span className="cfp-nbn-tail">per month inc GST</span>
                </div>
              </div>
            ))}
          </div>
          <p className="cfp-footnote" data-reveal>
            Speeds shown as download / upload. Typical evening speeds measured 7–11pm. Static IP
            and 4G failover available on request. Where a plan is included in this proposal, the
            connection, hardware and configuration are covered in the scope of works.
          </p>
          <p className="cfp-standards" data-reveal>
            ALL WORKS CARRIED OUT TO AUSTRALIAN STANDARDS&ensp;·&ensp;{COMPANY.standards}
          </p>
        </div>
      </section>

      <Marquee reverse />

      {/* ── Testimonials ── */}
      <section className="cfp-section" id="clients">
        <div className="cfp-wm" aria-hidden="true"><span className="cfp-watermark" data-drift="0.09">05</span></div>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>WHAT OUR CLIENTS SAY</p>
          <SplitWords text="Don't take our word for it." />
        </div>
        <div className="cfp-container-wide cfp-z">
          <div className="cfp-testimonials">
            {TESTIMONIALS.map((t, i) => (
              <figure key={t.who} className="cfp-tcard cfp-glass" data-reveal="zoom" style={{ transitionDelay: `${0.08 * i}s` }}>
                <span className="cfp-tmark">&ldquo;</span>
                <blockquote className="cfp-tquote">{t.quote}</blockquote>
                <figcaption className="cfp-twho">— {t.who}</figcaption>
              </figure>
            ))}
          </div>
          <p className="cfp-swipe-hint">Swipe for more →</p>
        </div>
      </section>

      {/* ── Transition into the quote ── */}
      <section className="cfp-transition">
        <div className="cfp-beams" aria-hidden="true">
          <div className="cfp-beam" />
          <div className="cfp-comet" />
        </div>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>YOUR QUOTATION</p>
          <h2 className="cfp-transition-title" data-reveal="zoom">
            <span className="cfp-shimmer">Let&apos;s build it.</span>
          </h2>
          {/* One template literal per sentence — the compiler drops spaces
              between JSX expressions and adjacent text ("5115and"). */}
          <p className="cfp-para" data-reveal>
            {`The full scope of works and your investment${siteName ? ` for ${siteName}` : ""} — ready to review and accept below. Questions at any point — call ${COMPANY.phone} and talk directly to the team who'll build it. Prefer paper?`}{" "}
            <a className="cfp-pdf-link" href={`/api/quotes/by-token/${token}/pdf`} target="_blank" rel="noopener noreferrer">
              Download the PDF copy
            </a>
            .
          </p>
          <div className="cfp-transition-cue" data-reveal>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </section>

      {/* ── The live quote + Accept/Decline ── */}
      <div ref={quoteRefEl} id="quote" className={`cfp-quote${quoteReached ? "" : " cfp-offstage"}`}>
        <QuoteResponseView {...props} />
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
  html:has(.cfp-root) { scroll-behavior: smooth; background: #0b1220; }
  @media (prefers-reduced-motion: reduce) { html:has(.cfp-root) { scroll-behavior: auto; } }

  .cfp-root {
    font-family: var(--font-geist-sans), 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    background:
      radial-gradient(90% 60% at 50% 0%, #12203a 0%, transparent 60%),
      linear-gradient(180deg, #0b1220 0%, #0f172a 45%, #0b1220 100%);
    -webkit-font-smoothing: antialiased;
    --pageP: 0;
    /* Pre-reveal slide-in elements (translateX ±56px) poke past the viewport
       on phones and made the whole page pan sideways. clip (NOT hidden —
       hidden would kill position:sticky for the card deck) fences them in. */
    overflow-x: clip;
  }
  .cfp-container { max-width: 1060px; margin: 0 auto; padding: 0 clamp(20px, 4vw, 32px); }
  .cfp-container-wide { max-width: 1180px; margin: 0 auto; padding: 0 clamp(20px, 4vw, 32px); }
  .cfp-z { position: relative; z-index: 2; }

  /* ── Ambient layers ── */
  .cfp-canvas {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    z-index: 0;
    pointer-events: none;
    opacity: .8;
    transition: opacity 1s ease;
  }
  .cfp-spotlight {
    position: fixed;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: radial-gradient(560px at var(--mx, -999px) var(--my, -999px), rgba(59,130,246,.08), transparent 70%);
    transition: opacity 1s ease;
  }
  /* The ambient layers stay on for the whole scroll — the quote section's
     opaque paper covers them anyway, and fading them out latched them off
     for good when the customer scrolled back UP into the story. */
  @media (pointer: coarse) { .cfp-spotlight { display: none; } }

  .cfp-beams { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
  .cfp-beam {
    position: absolute;
    top: 22%;
    left: -20vmax;
    width: 150vmax;
    height: 170px;
    background: linear-gradient(90deg, transparent, rgba(59,130,246,.10), rgba(147,197,253,.15), rgba(59,130,246,.10), transparent);
    filter: blur(34px);
    transform: rotate(-16deg);
    animation: cfp-beam-float 15s ease-in-out infinite alternate;
  }
  .cfp-beam2 { top: 62%; height: 120px; opacity: .75; animation-duration: 20s; animation-delay: -7s; }
  @keyframes cfp-beam-float {
    from { transform: rotate(-16deg) translateX(-5%) translateY(-12px); }
    to   { transform: rotate(-14deg) translateX(5%) translateY(12px); }
  }
  .cfp-comet {
    position: absolute;
    top: 16%;
    left: -320px;
    width: 280px;
    height: 2px;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, rgba(147,197,253,.95));
    filter: drop-shadow(0 0 8px rgba(147,197,253,.9));
    transform: rotate(14deg);
    animation: cfp-comet 8.5s linear infinite;
    animation-delay: 1.2s;
    opacity: 0;
  }
  .cfp-comet2 { top: 58%; animation-duration: 11s; animation-delay: 5.4s; }
  @keyframes cfp-comet {
    0%   { transform: rotate(14deg) translateX(0); opacity: 0; }
    3%   { opacity: .9; }
    13%  { transform: rotate(14deg) translateX(120vw); opacity: 0; }
    100% { transform: rotate(14deg) translateX(120vw); opacity: 0; }
  }

  /* ── Shimmer type ── */
  .cfp-shimmer {
    background: linear-gradient(110deg, #ffffff 32%, #93c5fd 46%, #e0edff 50%, #93c5fd 54%, #ffffff 68%);
    background-size: 230% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: cfp-shimmer 7s ease-in-out infinite;
  }
  @keyframes cfp-shimmer {
    0%, 100% { background-position: 115% 0; }
    45%, 55% { background-position: -15% 0; }
  }

  /* ── Scroll progress bar ── */
  .cfp-progress {
    position: fixed;
    top: 0; left: 0;
    height: 3px;
    width: 100%;
    transform-origin: 0 50%;
    transform: scaleX(var(--pageP));
    background: linear-gradient(90deg, #3b82f6, #93c5fd);
    box-shadow: 0 0 12px rgba(59,130,246,.55);
    z-index: 60;
    pointer-events: none;
  }

  /* ── Dot navigation (desktop only) ── */
  .cfp-dots {
    position: fixed;
    right: 22px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 55;
  }
  @media (max-width: 1120px) { .cfp-dots { display: none; } }
  .cfp-dot {
    position: relative;
    width: 10px; height: 10px;
    border-radius: 50%;
    border: 2px solid rgba(148,163,184,.5);
    background: transparent;
    cursor: pointer;
    padding: 0;
    transition: transform .3s ease, background .3s ease, border-color .3s ease, box-shadow .3s ease;
  }
  .cfp-dot:hover { border-color: #3b82f6; }
  .cfp-dot-active {
    background: #3b82f6;
    border-color: #3b82f6;
    transform: scale(1.35);
    box-shadow: 0 0 12px rgba(59,130,246,.8);
  }
  .cfp-dot-label {
    position: absolute;
    right: 22px;
    top: 50%;
    transform: translateY(-50%);
    background: #1e293b;
    color: #e2e8f0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .4px;
    padding: 5px 10px;
    border-radius: 6px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity .25s ease;
    box-shadow: 0 4px 14px rgba(0,0,0,.4);
  }
  .cfp-dot:hover .cfp-dot-label { opacity: 1; }

  /* ── Reveal-on-scroll variants ── */
  [data-reveal] {
    opacity: 0;
    transform: translateY(34px) scale(.98);
    transition: opacity .8s cubic-bezier(.2,.65,.25,1), transform .8s cubic-bezier(.2,.65,.25,1);
    will-change: opacity, transform;
  }
  [data-reveal="zoom"]  { transform: translateY(20px) scale(.86); }
  [data-reveal="left"]  { transform: translateX(-56px) scale(.99); }
  [data-reveal="right"] { transform: translateX(56px) scale(.99); }
  [data-reveal="wipe"] {
    clip-path: inset(0 100% 0 0);
    transform: translateY(16px);
    transition: clip-path 1s cubic-bezier(.2,.65,.25,1), opacity .6s ease, transform 1s cubic-bezier(.2,.65,.25,1);
  }
  [data-reveal].cfp-in {
    opacity: 1;
    transform: none;
    clip-path: inset(0 0 0 0);
    /* release the compositor layer once revealed — dozens of live
       will-change layers thrash GPU memory on weak machines */
    will-change: auto;
  }

  /* ── Lite mode — auto-detected on machines that can't hold ~35fps ──
     The story, reveals, shimmer, marquee and sticky deck all stay; only the
     per-frame-expensive layers go: backdrop blur re-samples on every scroll
     frame, comets/spotlight force constant repaints, and the beam float
     animation keeps a huge blurred layer active. */
  .cfp-lite .cfp-glass {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: linear-gradient(180deg, rgba(30,41,59,.82), rgba(15,23,42,.9));
  }
  .cfp-lite .cfp-chip {
    backdrop-filter: none;
    background: rgba(30,41,59,.85);
  }
  .cfp-lite .cfp-spotlight { display: none; }
  .cfp-lite .cfp-comet { display: none; }
  .cfp-lite .cfp-beam { animation: none; filter: blur(22px); }
  .cfp-lite .cfp-hero::before { animation: none; }

  /* ── Split-word headings ── */
  [data-reveal="split"] { opacity: 1; transform: none; transition: none; }
  .cfp-w {
    display: inline-block;
    overflow: hidden;
    vertical-align: top;
    margin-right: .26em;
    padding-bottom: .06em;
  }
  .cfp-wi {
    display: inline-block;
    transform: translateY(118%) rotate(3deg);
    transition: transform .9s cubic-bezier(.2,.65,.25,1);
  }
  [data-reveal="split"].cfp-in .cfp-wi { transform: none; }

  /* ── Statement ── */
  .cfp-statement {
    min-height: 92svh;
    display: flex;
    align-items: center;
    position: relative;
    z-index: 2;
    border-top: 1px solid rgba(30,41,59,.65);
    padding: clamp(56px, 8vw, 96px) 0;
  }
  .cfp-statement-line {
    font-size: clamp(46px, 10.5vw, 132px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.04;
    color: #fff;
    margin: 0;
  }
  .cfp-statement-outline {
    color: transparent;
    -webkit-text-stroke: 2px rgba(148,163,184,.65);
  }

  /* ── Marquee ── */
  .cfp-marquee {
    position: relative;
    z-index: 2;
    overflow: hidden;
    border-top: 1px solid rgba(30,41,59,.8);
    border-bottom: 1px solid rgba(30,41,59,.8);
    padding: clamp(26px, 4vw, 38px) 0;
    background: rgba(15,23,42,.4);
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
  }
  .cfp-marquee-track {
    display: flex;
    width: max-content;
    animation: cfp-marquee 36s linear infinite;
  }
  .cfp-marquee-reverse { animation-direction: reverse; }
  .cfp-marquee-seg { display: flex; flex-shrink: 0; }
  .cfp-marquee-item {
    display: flex;
    align-items: center;
    font-size: clamp(14px, 1.9vw, 20px);
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #526078;
    white-space: nowrap;
  }
  .cfp-marquee-dot { color: #3b82f6; margin: 0 clamp(20px, 3.2vw, 40px); }
  @keyframes cfp-marquee {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }

  /* ── Sticky stack (differentiators) ── */
  .cfp-stack { display: flex; flex-direction: column; margin-top: 20px; }
  .cfp-stack-card {
    position: sticky;
    display: flex;
    gap: clamp(18px, 3vw, 40px);
    align-items: flex-start;
    background: linear-gradient(180deg, #16233c, #0e1a30);
    border: 1px solid rgba(71,85,105,.55);
    border-radius: 18px;
    padding: clamp(24px, 4vw, 40px);
    margin-bottom: 16vh;
    box-shadow: 0 -18px 50px -30px rgba(0,0,0,.8), 0 24px 60px -30px rgba(0,0,0,.6);
  }
  .cfp-stack-card:last-child { margin-bottom: 0; }

  /* ── Watermark numerals ── */
  /* The wrapper does the clipping so the SECTION can stay overflow:visible —
     overflow:hidden on the section itself kills position:sticky for the
     stacking card deck inside it. */
  .cfp-wm {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }
  .cfp-watermark {
    position: absolute;
    top: -20px;
    right: clamp(56px, 6vw, 110px);
    font-size: clamp(150px, 24vw, 300px);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px rgba(148,163,184,.13);
    user-select: none;
  }

  /* ── Glass panels ── */
  .cfp-glass {
    background: linear-gradient(180deg, rgba(30,41,59,.55), rgba(15,23,42,.6));
    border: 1px solid rgba(71,85,105,.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  /* ── Hero ── */
  .cfp-hero {
    position: relative;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    color: #fff;
    overflow: hidden;
    --sp: 0;
  }
  .cfp-hero::before {
    content: "";
    position: absolute;
    inset: -25%;
    background:
      radial-gradient(42% 36% at 76% 14%, rgba(59,130,246,.26), transparent 62%),
      radial-gradient(36% 42% at 14% 86%, rgba(99,102,241,.16), transparent 60%);
    animation: cfp-drift 16s ease-in-out infinite alternate;
    pointer-events: none;
  }
  @keyframes cfp-drift {
    from { transform: translate3d(-2%, -1.5%, 0) scale(1) rotate(-1deg); }
    to   { transform: translate3d(2%, 2%, 0) scale(1.07) rotate(1deg); }
  }

  .cfp-hero-bar { position: relative; z-index: 2; padding-top: clamp(20px, 3.5vw, 36px); }
  .cfp-hero-bar-inner { display: flex; justify-content: space-between; align-items: center; }
  .cfp-hero-logo { height: clamp(30px, 4.5vw, 38px); width: auto; }
  .cfp-hero-meta { text-align: right; display: flex; flex-direction: column; gap: 2px; }
  .cfp-hero-ref { font-size: 13px; font-weight: 700; letter-spacing: .5px; color: #e2e8f0; font-family: var(--font-geist-mono, Consolas), monospace; }
  .cfp-hero-date { font-size: 11px; color: #64748b; }

  .cfp-hero-body {
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    align-items: center;
    padding: 48px 0;
  }
  .cfp-hero-inner {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    transform: translateY(calc(var(--sp) * -80px)) scale(calc(1 - var(--sp) * .1));
    opacity: calc(1 - var(--sp) * 1.2);
  }
  .cfp-hero-item {
    opacity: 0;
    animation: cfp-hero-up 1s cubic-bezier(.2,.65,.25,1) forwards;
  }
  @keyframes cfp-hero-up {
    from { opacity: 0; transform: translateY(34px) scale(1.06); filter: blur(6px); }
    to   { opacity: 1; transform: none; filter: blur(0); }
  }
  /* Under reduced motion the scroll driver never advances --sp, so the
     parallax transform above stays at identity — no override needed. The
     one-shot entrance animation runs for everyone. */

  .cfp-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 4.5px;
    color: #94a3b8;
    margin: 0 0 16px;
  }
  .cfp-hero-title {
    font-size: clamp(40px, 8vw, 88px);
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.04;
    margin: 0;
    max-width: 20ch;
  }
  .cfp-hero-site { display: block; color: #64748b; }
  .cfp-hero-address { font-size: clamp(14px, 2vw, 18px); color: #94a3b8; margin: 18px 0 0; }
  .cfp-hero-rule { width: 56px; height: 3px; background: linear-gradient(90deg, #3b82f6, #93c5fd); margin: 28px auto; border-radius: 2px; box-shadow: 0 0 14px rgba(59,130,246,.6); }
  .cfp-hero-lead {
    font-size: clamp(15px, 2.2vw, 19px);
    color: #cbd5e1;
    line-height: 1.7;
    max-width: 560px;
    margin: 0 0 30px;
  }
  .cfp-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 720px; }
  .cfp-chip {
    border: 1px solid #334155;
    border-radius: 999px;
    padding: 7px 16px;
    font-size: 12.5px;
    color: #e2e8f0;
    background: rgba(30,41,59,.5);
    backdrop-filter: blur(4px);
    transition: border-color .3s ease, box-shadow .3s ease;
  }
  .cfp-chip:hover { border-color: #3b82f6; box-shadow: 0 0 18px -4px rgba(59,130,246,.5); }

  .cfp-scroll-cue {
    position: relative;
    z-index: 2;
    align-self: center;
    margin-bottom: 28px;
    color: #64748b;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    opacity: 0;
    animation: cfp-hero-up 1s cubic-bezier(.2,.65,.25,1) forwards;
  }
  .cfp-scroll-cue-text { font-size: 10.5px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; }
  .cfp-scroll-cue svg { animation: cfp-bob 2.2s ease-in-out infinite; display: block; }
  @keyframes cfp-bob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(7px); }
  }

  /* ── Stats ── */
  .cfp-stats {
    position: relative;
    z-index: 2;
    border-top: 1px solid rgba(30,41,59,.9);
    padding: clamp(48px, 8vw, 88px) 0;
  }
  .cfp-stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
  }
  .cfp-stat { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 9px; }
  .cfp-stat-n {
    font-size: clamp(38px, 6vw, 64px);
    font-weight: 800;
    color: #fff;
    letter-spacing: -0.02em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 60px rgba(96,165,250,.16), 0 0 120px rgba(96,165,250,.10);
  }
  .cfp-stat-label { font-size: 10.5px; font-weight: 700; letter-spacing: 1.6px; color: #64748b; }
  @media (max-width: 640px) {
    .cfp-stats-grid { grid-template-columns: repeat(2, 1fr); gap: 36px 16px; }
  }

  /* ── Sections ── */
  /* overflow stays visible — hidden here would break position:sticky for the
     stacking deck. Clipping is handled per-layer (.cfp-wm). */
  .cfp-section {
    position: relative;
    padding: clamp(72px, 11vw, 132px) 0;
    border-top: 1px solid rgba(30,41,59,.65);
  }
  .cfp-glow::after {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(50% 45% at 80% 12%, rgba(59,130,246,.13), transparent 62%);
    pointer-events: none;
    z-index: 0;
  }

  .cfp-h2 {
    font-size: clamp(28px, 4.8vw, 48px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.12;
    color: #ffffff;
    margin: 0 0 24px;
  }
  .cfp-h3 { font-size: clamp(19px, 2.6vw, 25px); font-weight: 700; letter-spacing: -0.01em; color: #ffffff; margin: 0 0 18px; }
  .cfp-para {
    font-size: clamp(15px, 2vw, 17.5px);
    color: #b7c3d6;
    line-height: 1.75;
    max-width: 760px;
    margin: 0 0 16px;
  }
  .cfp-sublabel { font-size: 11px; font-weight: 700; letter-spacing: 2.2px; color: #64748b; margin: 48px 0 18px; }

  .cfp-brands { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 40px; }
  .cfp-brand {
    display: flex; flex-direction: column; gap: 3px;
    border-radius: 12px;
    padding: 18px 20px;
    transition: transform .3s ease, border-color .3s ease;
  }
  .cfp-brand:hover { transform: translateY(-4px); border-color: rgba(96,165,250,.55); }
  .cfp-brand-name { font-size: 16px; font-weight: 700; color: #fff; }
  .cfp-brand-count { font-size: 13px; color: #64748b; }
  @media (max-width: 640px) { .cfp-brands { grid-template-columns: repeat(2, 1fr); gap: 10px; } }

  .cfp-award {
    position: relative;
    border-radius: 16px;
    padding: 26px 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    background: linear-gradient(180deg, rgba(30,41,59,.75), rgba(15,23,42,.85));
    border: 1px solid rgba(96,165,250,.35);
    box-shadow: 0 0 60px -18px rgba(59,130,246,.45), inset 0 1px 0 rgba(148,163,184,.15);
  }
  .cfp-award-kicker { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: #93c5fd; margin: 0 0 5px; }
  .cfp-award-title { font-size: clamp(15px, 2.2vw, 19px); font-weight: 700; color: #fff; margin: 0; }
  .cfp-award-licences { font-size: 12px; color: #94a3b8; text-align: right; max-width: 46%; line-height: 1.6; margin: 0; }
  @media (max-width: 640px) {
    .cfp-award { flex-direction: column; align-items: flex-start; gap: 14px; }
    .cfp-award-licences { text-align: left; max-width: none; }
  }

  /* ── Differentiators (inside the sticky stack) ── */
  .cfp-diff-num {
    font-size: clamp(26px, 3.6vw, 40px);
    font-weight: 800;
    line-height: 1.05;
    min-width: 60px;
    font-variant-numeric: tabular-nums;
    background: linear-gradient(180deg, #93c5fd, #3b82f6);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .cfp-diff-title { font-size: clamp(17px, 2.5vw, 22px); font-weight: 700; color: #fff; margin: 0 0 7px; }
  .cfp-diff-body { font-size: clamp(14px, 1.9vw, 16px); color: #a3b2c7; line-height: 1.7; margin: 0; max-width: 740px; }

  /* ── Support cards + pills ── */
  .cfp-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 34px; }
  .cfp-card {
    position: relative;
    border-radius: 14px;
    padding: 24px;
    overflow: hidden;
    transition: transform .35s ease, border-color .35s ease, box-shadow .35s ease;
  }
  .cfp-card::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg, #3b82f6, rgba(147,197,253,.3), transparent);
  }
  .cfp-card:hover {
    transform: translateY(-6px);
    border-color: rgba(96,165,250,.55);
    box-shadow: 0 18px 50px -18px rgba(59,130,246,.4);
  }
  .cfp-card-title { font-size: 16.5px; font-weight: 700; color: #fff; margin: 0 0 8px; }
  .cfp-card-body { font-size: 14px; color: #a3b2c7; line-height: 1.65; margin: 0; }
  @media (max-width: 760px) { .cfp-cards { grid-template-columns: 1fr; } }

  .cfp-pills { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .cfp-pill {
    border-radius: 12px;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    transition: transform .3s ease, border-color .3s ease;
  }
  .cfp-pill:hover { transform: translateY(-3px); border-color: rgba(96,165,250,.5); }
  .cfp-pill-name { font-size: 14.5px; font-weight: 700; color: #fff; }
  .cfp-pill-desc { font-size: 13px; color: #8fa0b8; line-height: 1.55; }
  @media (max-width: 640px) { .cfp-pills { grid-template-columns: 1fr; } }

  /* ── NBN ── */
  .cfp-nbn { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
  .cfp-nbn-row {
    display: grid;
    grid-template-columns: 1.2fr 1.1fr auto;
    gap: 16px;
    align-items: center;
    padding: 20px 24px;
    border-radius: 14px;
    transition: transform .3s ease, border-color .3s ease, box-shadow .3s ease;
  }
  .cfp-nbn-row:hover {
    transform: translateX(6px);
    border-color: rgba(96,165,250,.6);
    box-shadow: 0 0 40px -12px rgba(59,130,246,.5);
  }
  .cfp-nbn-plan, .cfp-nbn-speed, .cfp-nbn-price { display: flex; flex-direction: column; gap: 2px; }
  .cfp-nbn-name { font-size: 16.5px; font-weight: 700; color: #fff; }
  .cfp-nbn-fit { font-size: 12px; color: #8fa0b8; line-height: 1.45; }
  .cfp-nbn-mbps { font-size: 15px; font-weight: 700; color: #e2e8f0; font-variant-numeric: tabular-nums; }
  .cfp-nbn-evening { font-size: 11.5px; color: #64748b; }
  .cfp-nbn-price { text-align: right; align-items: flex-end; }
  .cfp-nbn-dollars { font-size: 24px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
  .cfp-nbn-tail { font-size: 10.5px; color: #64748b; }
  @media (max-width: 640px) {
    .cfp-nbn-row { grid-template-columns: 1fr auto; }
    .cfp-nbn-speed { grid-column: 1 / -1; flex-direction: row; gap: 10px; align-items: baseline; }
  }
  .cfp-footnote { font-size: 12px; color: #64748b; line-height: 1.6; margin: 18px 0 0; max-width: 820px; }
  .cfp-standards { font-size: 11px; letter-spacing: .4px; color: #526078; margin: 38px 0 0; line-height: 1.7; }

  /* ── Testimonials ── */
  .cfp-testimonials { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 10px; }
  .cfp-tcard {
    border-radius: 16px;
    padding: 28px;
    margin: 0;
    transition: transform .35s ease, border-color .35s ease, box-shadow .35s ease;
  }
  .cfp-tcard:hover {
    transform: translateY(-5px) rotate(-.4deg);
    border-color: rgba(96,165,250,.45);
    box-shadow: 0 20px 54px -22px rgba(59,130,246,.35);
  }
  .cfp-tmark { font-size: 40px; font-weight: 800; color: #3b82f6; line-height: 1; display: block; margin-bottom: 8px; opacity: .8; }
  .cfp-tquote { font-size: 15px; color: #c3cede; line-height: 1.7; font-style: italic; margin: 0; }
  .cfp-twho { font-size: 13px; font-weight: 700; color: #fff; margin-top: 16px; }
  .cfp-swipe-hint { display: none; }
  @media (max-width: 720px) {
    .cfp-testimonials {
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      gap: 12px;
      padding-bottom: 6px;
      margin-left: -8px;
      margin-right: -8px;
      padding-left: 8px;
      padding-right: 8px;
      scrollbar-width: none;
    }
    .cfp-testimonials::-webkit-scrollbar { display: none; }
    .cfp-tcard { flex: 0 0 84%; scroll-snap-align: center; }
    .cfp-swipe-hint {
      display: block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1px;
      color: #64748b;
      text-align: center;
      margin: 14px 0 0;
    }
  }

  /* ── Transition band ── */
  .cfp-transition {
    position: relative;
    padding: clamp(88px, 14vw, 170px) 0;
    border-top: 1px solid rgba(30,41,59,.65);
    overflow: hidden;
    text-align: center;
  }
  .cfp-transition .cfp-para { margin-left: auto; margin-right: auto; }
  .cfp-transition-title {
    font-size: clamp(44px, 9vw, 104px);
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.05;
    color: #fff;
    margin: 0 0 22px;
  }
  .cfp-transition-cue { color: #475569; margin-top: 26px; display: flex; justify-content: center; }
  .cfp-transition-cue svg { animation: cfp-bob 2.2s ease-in-out infinite; }
  .cfp-pdf-link { color: #93c5fd; text-decoration: underline; text-underline-offset: 3px; }

  /* ── Quote section — clean paper after the dark story ── */
  .cfp-quote { position: relative; z-index: 2; background: #f1f5f9; }
  .cfp-quote .qr-sticky { transition: transform .5s cubic-bezier(.2,.8,.2,1); }
  .cfp-offstage .qr-sticky { transform: translateY(140%); }
  @media (prefers-reduced-motion: reduce) {
    .cfp-quote .qr-sticky { transition: none; }
    .cfp-offstage .qr-sticky { transform: none; }
  }
`;
