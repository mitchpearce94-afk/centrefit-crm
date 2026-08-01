"use client";

/**
 * Web proposal — the interactive, scroll-driven version of the proposal PDF.
 * See docs/proposal-web-CONTEXT.md (D1–D8). Copy comes from
 * lib/proposal-content.ts (shared with the PDF); everything client-specific
 * merges in from the quote + scope. The page ends on the live quote with the
 * existing Accept/Decline flow (QuoteResponseView) — the sticky respond bar
 * stays offstage until the customer reaches the quotation section.
 *
 * The "journey" layer is deliberately library-free: one rAF scroll driver
 * feeds CSS custom properties (hero parallax, page progress, watermark
 * drift), IntersectionObservers handle reveals + the active dot-nav section,
 * and everything collapses to static content under prefers-reduced-motion.
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

// ── Stat counter ───────────────────────────────────────────────────────────
// Parses "10+", "100+", "3", "24/7" → animates the leading integer once the
// tile scrolls into view, keeps the suffix ("+", "/7") static.

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
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setN(target);
          return;
        }
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

  // One effect wires the whole journey: reveal observers, the rAF scroll
  // driver (page progress bar, hero parallax, watermark drift) and the
  // dot-nav active-section tracker.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    // 1. Reveal-on-scroll.
    const revealEls = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (reduced) {
      revealEls.forEach((el) => el.classList.add("cfp-in"));
    } else {
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
    }

    // 2. Scroll driver — progress bar + hero parallax + watermark drift.
    const hero = root.querySelector<HTMLElement>(".cfp-hero");
    const driftEls = Array.from(root.querySelectorAll<HTMLElement>("[data-drift]"));
    if (!reduced) {
      let ticking = false;
      const frame = () => {
        ticking = false;
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const pageP = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        root.style.setProperty("--pageP", String(pageP));
        if (hero) {
          const sp = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9)));
          hero.style.setProperty("--sp", String(sp));
        }
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

    // 3. Dot-nav active section.
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

  // The quote's sticky Accept/Decline bar slides in only once the customer
  // reaches the quotation section — it shouldn't hover over the story.
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
    <div className="cfp-root" ref={rootRef}>
      <style>{CSS}</style>

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
              {clientName}
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

      {/* ── Who we are ── */}
      <section className="cfp-section cfp-light" id="who">
        <span className="cfp-watermark" data-drift="0.09">01</span>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>WHO WE ARE</p>
          <h2 className="cfp-h2" data-reveal="wipe">Technology for spaces where people gather.</h2>
          {WHO_WE_ARE.map((p, i) => (
            <p key={i} className="cfp-para" data-reveal style={{ transitionDelay: `${0.08 * (i + 1)}s` }}>
              {p}
            </p>
          ))}

          <p className="cfp-sublabel" data-reveal>WHO WE&apos;VE BUILT FOR</p>
          <div className="cfp-brands">
            {COMPANY.brands.map((b, i) => (
              <div key={b.name} className="cfp-brand" data-reveal="zoom" style={{ transitionDelay: `${0.07 * i}s` }}>
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
      <section className="cfp-section cfp-white" id="why">
        <span className="cfp-watermark" data-drift="0.11">02</span>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>WHY CENTREFIT</p>
          <h2 className="cfp-h2" data-reveal="wipe">What we do differently.</h2>
          <div className="cfp-diffs">
            {DIFFERENTIATORS.map((d, i) => (
              <div
                key={d.title}
                className="cfp-diff"
                data-reveal={i % 2 === 0 ? "left" : "right"}
                style={{ transitionDelay: `${0.05 * i}s` }}
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
      <section className="cfp-section cfp-light" id="support">
        <span className="cfp-watermark" data-drift="0.09">03</span>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>AFTER THE INSTALL</p>
          <h2 className="cfp-h2" data-reveal="wipe">Support that doesn&apos;t clock off.</h2>
          <p className="cfp-para" data-reveal>
            The installation is where most contractors finish. It&apos;s where we start — every
            Centrefit site is backed by the team that built it.
          </p>
          <div className="cfp-cards">
            {SUPPORT_CARDS.map((c, i) => (
              <div key={c.title} className="cfp-card" data-reveal="zoom" style={{ transitionDelay: `${0.09 * i}s` }}>
                <h3 className="cfp-card-title">{c.title}</h3>
                <p className="cfp-card-body">{c.body}</p>
              </div>
            ))}
          </div>

          <p className="cfp-kicker" style={{ marginTop: "64px" }} data-reveal>BEYOND THIS PROPOSAL</p>
          <h3 className="cfp-h3" data-reveal>One relationship, the whole stack.</h3>
          <div className="cfp-pills">
            {OFFERINGS.map((o, i) => (
              <div key={o.name} className="cfp-pill" data-reveal="zoom" style={{ transitionDelay: `${0.05 * i}s` }}>
                <span className="cfp-pill-name">{o.name}</span>
                <span className="cfp-pill-desc">{o.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NBN ── */}
      <section className="cfp-section cfp-dark cfp-glow" id="connectivity">
        <span className="cfp-watermark cfp-watermark-dark" data-drift="0.11">04</span>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker cfp-kicker-dark" data-reveal>CONNECTIVITY</p>
          <h2 className="cfp-h2 cfp-h2-dark" data-reveal="wipe">Business internet, managed by us.</h2>
          <p className="cfp-para cfp-para-dark" data-reveal>
            We&apos;re an internet provider as well as an integrator — one team for the connection,
            the network and everything running on it. Every plan is business-grade NBN with no
            lock-in and no setup fee, supported in Australia by the people who built your site.
          </p>
          <div className="cfp-nbn">
            {NBN_PLANS.map((p, i) => (
              <div key={p.name} className="cfp-nbn-row" data-reveal={i % 2 === 0 ? "left" : "right"} style={{ transitionDelay: `${0.05 * i}s` }}>
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

      {/* ── Testimonials ── */}
      <section className="cfp-section cfp-white" id="clients">
        <span className="cfp-watermark" data-drift="0.09">05</span>
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker" data-reveal>WHAT OUR CLIENTS SAY</p>
          <h2 className="cfp-h2" data-reveal="wipe">Don&apos;t take our word for it.</h2>
        </div>
        <div className="cfp-container-wide cfp-z">
          <div className="cfp-testimonials">
            {TESTIMONIALS.map((t, i) => (
              <figure key={t.who} className="cfp-tcard" data-reveal="zoom" style={{ transitionDelay: `${0.08 * i}s` }}>
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
      <section className="cfp-transition cfp-glow">
        <div className="cfp-container cfp-z">
          <p className="cfp-kicker cfp-kicker-dark" data-reveal>YOUR QUOTATION</p>
          <h2 className="cfp-transition-title" data-reveal="zoom">
            Let&apos;s build it.
          </h2>
          <p className="cfp-para cfp-para-dark" data-reveal>
            The full scope of works and your investment
            {siteName ? ` for ${siteName}` : ""} — ready to review and accept below.
            Questions at any point — call {COMPANY.phone} and talk directly to the team
            who&apos;ll build it. Prefer paper?{" "}
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
  html:has(.cfp-root) { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html:has(.cfp-root) { scroll-behavior: auto; } }

  .cfp-root {
    font-family: var(--font-geist-sans), 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #0f172a;
    background: #0f172a;
    -webkit-font-smoothing: antialiased;
    --pageP: 0;
  }
  .cfp-container { max-width: 1060px; margin: 0 auto; padding: 0 clamp(20px, 4vw, 32px); }
  .cfp-container-wide { max-width: 1180px; margin: 0 auto; padding: 0 clamp(20px, 4vw, 32px); }
  .cfp-z { position: relative; z-index: 1; }

  /* ── Scroll progress bar ── */
  .cfp-progress {
    position: fixed;
    top: 0; left: 0;
    height: 3px;
    width: 100%;
    transform-origin: 0 50%;
    transform: scaleX(var(--pageP));
    background: linear-gradient(90deg, #3b82f6, #93c5fd);
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
    border: 2px solid rgba(148,163,184,.55);
    background: transparent;
    cursor: pointer;
    padding: 0;
    transition: transform .3s ease, background .3s ease, border-color .3s ease;
  }
  .cfp-dot:hover { border-color: #3b82f6; }
  .cfp-dot-active { background: #3b82f6; border-color: #3b82f6; transform: scale(1.35); }
  .cfp-dot-label {
    position: absolute;
    right: 22px;
    top: 50%;
    transform: translateY(-50%);
    background: #0f172a;
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
    box-shadow: 0 4px 14px rgba(15,23,42,.25);
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
  }
  @media (prefers-reduced-motion: reduce) {
    [data-reveal], [data-reveal="wipe"] { opacity: 1; transform: none; clip-path: none; transition: none; }
  }

  /* ── Watermark numerals ── */
  .cfp-watermark {
    position: absolute;
    top: -20px;
    right: -8px;
    font-size: clamp(150px, 24vw, 300px);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px rgba(15,23,42,.08);
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }
  .cfp-watermark-dark { -webkit-text-stroke-color: rgba(148,163,184,.13); }

  /* ── Hero ── */
  .cfp-hero {
    position: relative;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    background: #0f172a;
    color: #fff;
    overflow: hidden;
    --sp: 0;
  }
  .cfp-hero::before {
    content: "";
    position: absolute;
    inset: -25%;
    background:
      radial-gradient(42% 36% at 78% 12%, rgba(59,130,246,.28), transparent 62%),
      radial-gradient(36% 42% at 12% 88%, rgba(99,102,241,.16), transparent 60%),
      radial-gradient(30% 30% at 50% 50%, rgba(148,163,184,.07), transparent 70%);
    animation: cfp-drift 16s ease-in-out infinite alternate;
    pointer-events: none;
  }
  .cfp-hero::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(148,163,184,.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148,163,184,.06) 1px, transparent 1px);
    background-size: 54px 54px;
    -webkit-mask-image: radial-gradient(75% 75% at 50% 42%, #000 15%, transparent 100%);
    mask-image: radial-gradient(75% 75% at 50% 42%, #000 15%, transparent 100%);
    pointer-events: none;
  }
  @keyframes cfp-drift {
    from { transform: translate3d(-2%, -1.5%, 0) scale(1) rotate(-1deg); }
    to   { transform: translate3d(2%, 2%, 0) scale(1.07) rotate(1deg); }
  }
  @media (prefers-reduced-motion: reduce) { .cfp-hero::before { animation: none; } }

  .cfp-hero-bar { position: relative; z-index: 1; padding-top: clamp(20px, 3.5vw, 36px); }
  .cfp-hero-bar-inner { display: flex; justify-content: space-between; align-items: center; }
  .cfp-hero-logo { height: clamp(30px, 4.5vw, 38px); width: auto; }
  .cfp-hero-meta { text-align: right; display: flex; flex-direction: column; gap: 2px; }
  .cfp-hero-ref { font-size: 13px; font-weight: 700; letter-spacing: .5px; color: #e2e8f0; font-family: var(--font-geist-mono, Consolas), monospace; }
  .cfp-hero-date { font-size: 11px; color: #64748b; }

  .cfp-hero-body {
    position: relative;
    z-index: 1;
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
  @media (prefers-reduced-motion: reduce) {
    .cfp-hero-item { animation: none; opacity: 1; }
    .cfp-hero-inner { transform: none; opacity: 1; }
  }

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
  .cfp-hero-rule { width: 56px; height: 3px; background: #fff; margin: 28px auto; }
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
    background: rgba(30,41,59,.4);
    backdrop-filter: blur(2px);
  }

  .cfp-scroll-cue {
    position: relative;
    z-index: 1;
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
  @media (prefers-reduced-motion: reduce) { .cfp-scroll-cue svg { animation: none; } }

  /* ── Stats ── */
  .cfp-stats {
    background: #0f172a;
    border-top: 1px solid #1e293b;
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
  }
  .cfp-stat-label { font-size: 10.5px; font-weight: 700; letter-spacing: 1.6px; color: #64748b; }
  @media (max-width: 640px) {
    .cfp-stats-grid { grid-template-columns: repeat(2, 1fr); gap: 36px 16px; }
  }

  /* ── Sections ── */
  .cfp-section { position: relative; padding: clamp(72px, 11vw, 132px) 0; overflow: hidden; }
  .cfp-light { background: #f8fafc; }
  .cfp-white { background: #ffffff; }
  .cfp-dark  { background: #0f172a; }
  .cfp-glow  { position: relative; }
  .cfp-glow::before {
    content: "";
    position: absolute;
    inset: -10%;
    background: radial-gradient(45% 40% at 82% 15%, rgba(59,130,246,.14), transparent 62%);
    pointer-events: none;
  }

  .cfp-h2 {
    font-size: clamp(28px, 4.8vw, 48px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.12;
    color: #0f172a;
    margin: 0 0 24px;
  }
  .cfp-h3 { font-size: clamp(19px, 2.6vw, 25px); font-weight: 700; letter-spacing: -0.01em; color: #0f172a; margin: 0 0 18px; }
  .cfp-h2-dark { color: #fff; }
  .cfp-kicker-dark { color: #64748b; }
  .cfp-para {
    font-size: clamp(15px, 2vw, 17.5px);
    color: #334155;
    line-height: 1.75;
    max-width: 760px;
    margin: 0 0 16px;
  }
  .cfp-para-dark { color: #cbd5e1; }
  .cfp-sublabel { font-size: 11px; font-weight: 700; letter-spacing: 2.2px; color: #94a3b8; margin: 48px 0 18px; }

  .cfp-brands { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 40px; }
  .cfp-brand {
    display: flex; flex-direction: column; gap: 3px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 18px 20px;
  }
  .cfp-brand-name { font-size: 16px; font-weight: 700; color: #0f172a; }
  .cfp-brand-count { font-size: 13px; color: #64748b; }
  @media (max-width: 640px) { .cfp-brands { grid-template-columns: repeat(2, 1fr); gap: 10px; } }

  .cfp-award {
    background: #0f172a;
    border-radius: 16px;
    padding: 26px 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    box-shadow: 0 18px 44px -18px rgba(15,23,42,.45);
  }
  .cfp-award-kicker { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin: 0 0 5px; }
  .cfp-award-title { font-size: clamp(15px, 2.2vw, 19px); font-weight: 700; color: #fff; margin: 0; }
  .cfp-award-licences { font-size: 12px; color: #94a3b8; text-align: right; max-width: 46%; line-height: 1.6; margin: 0; }
  @media (max-width: 640px) {
    .cfp-award { flex-direction: column; align-items: flex-start; gap: 14px; }
    .cfp-award-licences { text-align: left; max-width: none; }
  }

  /* ── Differentiators ── */
  .cfp-diffs { display: flex; flex-direction: column; }
  .cfp-diff {
    display: flex;
    gap: clamp(16px, 3vw, 38px);
    padding: 30px 0;
    border-bottom: 1px solid #e2e8f0;
  }
  .cfp-diff:last-child { border-bottom: none; }
  .cfp-diff-num {
    font-size: clamp(26px, 3.6vw, 40px);
    font-weight: 800;
    color: #dbe4f0;
    line-height: 1.05;
    min-width: 60px;
    font-variant-numeric: tabular-nums;
  }
  .cfp-diff-title { font-size: clamp(17px, 2.5vw, 22px); font-weight: 700; color: #0f172a; margin: 0 0 7px; }
  .cfp-diff-body { font-size: clamp(14px, 1.9vw, 16px); color: #475569; line-height: 1.7; margin: 0; max-width: 740px; }

  /* ── Support cards + pills ── */
  .cfp-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 34px; }
  .cfp-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-top: 3px solid #0f172a;
    border-radius: 14px;
    padding: 24px;
    transition: transform .35s ease, box-shadow .35s ease;
  }
  .cfp-card:hover { transform: translateY(-6px); box-shadow: 0 22px 44px -20px rgba(15,23,42,.28); }
  .cfp-card-title { font-size: 16.5px; font-weight: 700; color: #0f172a; margin: 0 0 8px; }
  .cfp-card-body { font-size: 14px; color: #475569; line-height: 1.65; margin: 0; }
  @media (max-width: 760px) { .cfp-cards { grid-template-columns: 1fr; } }

  .cfp-pills { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .cfp-pill {
    border: 1px solid #e2e8f0;
    background: #fff;
    border-radius: 12px;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    transition: transform .3s ease, border-color .3s ease;
  }
  .cfp-pill:hover { transform: translateY(-3px); border-color: #94a3b8; }
  .cfp-pill-name { font-size: 14.5px; font-weight: 700; color: #0f172a; }
  .cfp-pill-desc { font-size: 13px; color: #64748b; line-height: 1.55; }
  @media (max-width: 640px) { .cfp-pills { grid-template-columns: 1fr; } }

  /* ── NBN ── */
  .cfp-nbn { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
  .cfp-nbn-row {
    display: grid;
    grid-template-columns: 1.2fr 1.1fr auto;
    gap: 16px;
    align-items: center;
    padding: 20px 24px;
    border: 1px solid #1e293b;
    border-radius: 14px;
    background: rgba(30,41,59,.35);
    backdrop-filter: blur(2px);
    transition: transform .3s ease, border-color .3s ease, background .3s ease;
  }
  .cfp-nbn-row:hover { transform: translateX(6px); border-color: #3b82f6; background: rgba(30,41,59,.6); }
  .cfp-nbn-plan, .cfp-nbn-speed, .cfp-nbn-price { display: flex; flex-direction: column; gap: 2px; }
  .cfp-nbn-name { font-size: 16.5px; font-weight: 700; color: #fff; }
  .cfp-nbn-fit { font-size: 12px; color: #94a3b8; line-height: 1.45; }
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
  .cfp-standards { font-size: 11px; letter-spacing: .4px; color: #475569; margin: 38px 0 0; line-height: 1.7; }

  /* ── Testimonials ── */
  .cfp-testimonials { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 10px; }
  .cfp-tcard {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 28px;
    margin: 0;
    transition: transform .35s ease, box-shadow .35s ease;
  }
  .cfp-tcard:hover { transform: translateY(-5px) rotate(-.4deg); box-shadow: 0 22px 48px -22px rgba(15,23,42,.25); }
  .cfp-tmark { font-size: 40px; font-weight: 800; color: #cbd5e1; line-height: 1; display: block; margin-bottom: 8px; }
  .cfp-tquote { font-size: 15px; color: #334155; line-height: 1.7; font-style: italic; margin: 0; }
  .cfp-twho { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 16px; }
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
      color: #94a3b8;
      text-align: center;
      margin: 14px 0 0;
    }
  }

  /* ── Transition band ── */
  .cfp-transition {
    position: relative;
    background: #0f172a;
    padding: clamp(88px, 14vw, 170px) 0;
    border-bottom: 1px solid #1e293b;
    overflow: hidden;
    text-align: center;
  }
  .cfp-transition .cfp-para-dark { margin-left: auto; margin-right: auto; }
  .cfp-transition-title {
    font-size: clamp(40px, 8vw, 92px);
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.05;
    color: #fff;
    margin: 0 0 22px;
  }
  .cfp-transition-cue { color: #475569; margin-top: 26px; display: flex; justify-content: center; }
  .cfp-transition-cue svg { animation: cfp-bob 2.2s ease-in-out infinite; }
  .cfp-pdf-link { color: #93c5fd; text-decoration: underline; text-underline-offset: 3px; }

  /* ── Quote section — sticky respond bar stays offstage until reached ── */
  .cfp-quote .qr-sticky { transition: transform .5s cubic-bezier(.2,.8,.2,1); }
  .cfp-offstage .qr-sticky { transform: translateY(140%); }
  @media (prefers-reduced-motion: reduce) {
    .cfp-quote .qr-sticky { transition: none; }
    .cfp-offstage .qr-sticky { transform: none; }
  }
`;
