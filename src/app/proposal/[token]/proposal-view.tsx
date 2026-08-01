"use client";

/**
 * Web proposal — the interactive, scroll-driven version of the proposal PDF.
 * See docs/proposal-web-CONTEXT.md (D1–D8). Copy comes from
 * lib/proposal-content.ts (shared with the PDF); everything client-specific
 * merges in from the quote + scope. The page ends on the live quote with the
 * existing Accept/Decline flow (QuoteResponseView) — the sticky respond bar
 * stays offstage until the customer reaches the quotation section.
 *
 * Animation is CSS + IntersectionObserver only (no libraries), and every
 * effect collapses to static content under prefers-reduced-motion.
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
        const dur = 1400;
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
    <div className="cfp-stat" ref={ref}>
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

  // Reveal-on-scroll: every [data-reveal] element fades up when it enters the
  // viewport. Reduced-motion users see everything immediately.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      els.forEach((el) => el.classList.add("cfp-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("cfp-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
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

      {/* ── Hero ── */}
      <header className="cfp-hero">
        <div className="cfp-hero-bar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/centrefit-logo-white.png" alt="Centrefit Group" className="cfp-hero-logo" />
          <div className="cfp-hero-meta">
            <span className="cfp-hero-ref">{quoteRef}</span>
            <span className="cfp-hero-date">{dateStr}</span>
          </div>
        </div>

        <div className="cfp-hero-body">
          <p className="cfp-kicker cfp-hero-item" style={{ animationDelay: "0.05s" }}>
            PROJECT PROPOSAL
          </p>
          <h1 className="cfp-hero-title cfp-hero-item" style={{ animationDelay: "0.15s" }}>
            {clientName}
            {siteName && <span className="cfp-hero-site">{siteName}</span>}
          </h1>
          {siteAddress && (
            <p className="cfp-hero-address cfp-hero-item" style={{ animationDelay: "0.28s" }}>
              {siteAddress}
            </p>
          )}
          <div className="cfp-hero-rule cfp-hero-item" style={{ animationDelay: "0.38s" }} />
          <p className="cfp-hero-lead cfp-hero-item" style={{ animationDelay: "0.46s" }}>
            A complete technology fit-out — designed, installed, commissioned and supported by
            one team.
          </p>
          {systems.length > 0 && (
            <div className="cfp-chips cfp-hero-item" style={{ animationDelay: "0.56s" }}>
              {systems.map((name) => (
                <span key={name} className="cfp-chip">{name}</span>
              ))}
            </div>
          )}
        </div>

        <a href="#story" className="cfp-scroll-cue cfp-hero-item" style={{ animationDelay: "0.8s" }} aria-label="Scroll to proposal">
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
      <section className="cfp-section cfp-light">
        <div className="cfp-container">
          <p className="cfp-kicker" data-reveal>WHO WE ARE</p>
          <h2 className="cfp-h2" data-reveal>Technology for spaces where people gather.</h2>
          {WHO_WE_ARE.map((p, i) => (
            <p key={i} className="cfp-para" data-reveal style={{ transitionDelay: `${0.08 * (i + 1)}s` }}>
              {p}
            </p>
          ))}

          <p className="cfp-sublabel" data-reveal>WHO WE&apos;VE BUILT FOR</p>
          <div className="cfp-brands" data-reveal>
            {COMPANY.brands.map((b) => (
              <div key={b.name} className="cfp-brand">
                <span className="cfp-brand-name">{b.name}</span>
                <span className="cfp-brand-count">{b.count}</span>
              </div>
            ))}
          </div>

          <div className="cfp-award" data-reveal>
            <div>
              <p className="cfp-award-kicker">AWARDED</p>
              <p className="cfp-award-title">{COMPANY.award}</p>
            </div>
            <p className="cfp-award-licences">{COMPANY.licences}</p>
          </div>
        </div>
      </section>

      {/* ── Differentiators ── */}
      <section className="cfp-section cfp-white">
        <div className="cfp-container">
          <p className="cfp-kicker" data-reveal>WHY CENTREFIT</p>
          <h2 className="cfp-h2" data-reveal>What we do differently.</h2>
          <div className="cfp-diffs">
            {DIFFERENTIATORS.map((d, i) => (
              <div key={d.title} className="cfp-diff" data-reveal style={{ transitionDelay: `${0.06 * i}s` }}>
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
      <section className="cfp-section cfp-light">
        <div className="cfp-container">
          <p className="cfp-kicker" data-reveal>AFTER THE INSTALL</p>
          <h2 className="cfp-h2" data-reveal>Support that doesn&apos;t clock off.</h2>
          <p className="cfp-para" data-reveal>
            The installation is where most contractors finish. It&apos;s where we start — every
            Centrefit site is backed by the team that built it.
          </p>
          <div className="cfp-cards">
            {SUPPORT_CARDS.map((c, i) => (
              <div key={c.title} className="cfp-card" data-reveal style={{ transitionDelay: `${0.08 * i}s` }}>
                <h3 className="cfp-card-title">{c.title}</h3>
                <p className="cfp-card-body">{c.body}</p>
              </div>
            ))}
          </div>

          <p className="cfp-kicker" style={{ marginTop: "56px" }} data-reveal>BEYOND THIS PROPOSAL</p>
          <h3 className="cfp-h3" data-reveal>One relationship, the whole stack.</h3>
          <div className="cfp-pills">
            {OFFERINGS.map((o, i) => (
              <div key={o.name} className="cfp-pill" data-reveal style={{ transitionDelay: `${0.05 * i}s` }}>
                <span className="cfp-pill-name">{o.name}</span>
                <span className="cfp-pill-desc">{o.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NBN ── */}
      <section className="cfp-section cfp-dark">
        <div className="cfp-container">
          <p className="cfp-kicker cfp-kicker-dark" data-reveal>CONNECTIVITY</p>
          <h2 className="cfp-h2 cfp-h2-dark" data-reveal>Business internet, managed by us.</h2>
          <p className="cfp-para cfp-para-dark" data-reveal>
            We&apos;re an internet provider as well as an integrator — one team for the connection,
            the network and everything running on it. Every plan is business-grade NBN with no
            lock-in and no setup fee, supported in Australia by the people who built your site.
          </p>
          <div className="cfp-nbn" data-reveal>
            {NBN_PLANS.map((p) => (
              <div key={p.name} className="cfp-nbn-row">
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
      <section className="cfp-section cfp-white">
        <div className="cfp-container">
          <p className="cfp-kicker" data-reveal>WHAT OUR CLIENTS SAY</p>
          <h2 className="cfp-h2" data-reveal>Don&apos;t take our word for it.</h2>
          <div className="cfp-testimonials">
            {TESTIMONIALS.map((t, i) => (
              <figure key={t.who} className="cfp-tcard" data-reveal style={{ transitionDelay: `${0.07 * i}s` }}>
                <span className="cfp-tmark">&ldquo;</span>
                <blockquote className="cfp-tquote">{t.quote}</blockquote>
                <figcaption className="cfp-twho">— {t.who}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── Transition into the quote ── */}
      <section className="cfp-transition">
        <div className="cfp-container">
          <p className="cfp-kicker cfp-kicker-dark" data-reveal>YOUR QUOTATION</p>
          <h2 className="cfp-h2 cfp-h2-dark" data-reveal>
            The full scope of works and your investment
            {siteName ? ` for ${siteName}` : ""} — ready to review and accept below.
          </h2>
          <p className="cfp-para cfp-para-dark" data-reveal>
            Questions at any point — call {COMPANY.phone} and talk directly to the team
            who&apos;ll build it. Prefer paper?{" "}
            <a className="cfp-pdf-link" href={`/api/quotes/by-token/${token}/pdf`} target="_blank" rel="noopener noreferrer">
              Download the PDF copy
            </a>
            .
          </p>
        </div>
      </section>

      {/* ── The live quote + Accept/Decline ── */}
      <div ref={quoteRefEl} className={`cfp-quote${quoteReached ? "" : " cfp-offstage"}`}>
        <QuoteResponseView {...props} />
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
  .cfp-root {
    font-family: var(--font-geist-sans), 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #0f172a;
    background: #0f172a;
    -webkit-font-smoothing: antialiased;
  }
  .cfp-container { max-width: 1020px; margin: 0 auto; padding: 0 24px; }

  /* ── Reveal-on-scroll ── */
  [data-reveal] {
    opacity: 0;
    transform: translateY(26px);
    transition: opacity .7s cubic-bezier(.2,.65,.25,1), transform .7s cubic-bezier(.2,.65,.25,1);
  }
  [data-reveal].cfp-in { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) {
    [data-reveal] { opacity: 1; transform: none; transition: none; }
  }

  /* ── Hero ── */
  .cfp-hero {
    position: relative;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    background: #0f172a;
    color: #fff;
    overflow: hidden;
  }
  .cfp-hero::before {
    content: "";
    position: absolute;
    inset: -20%;
    background:
      radial-gradient(55% 45% at 82% 8%, rgba(59,130,246,.17), transparent 62%),
      radial-gradient(45% 55% at 8% 95%, rgba(148,163,184,.12), transparent 60%);
    animation: cfp-drift 18s ease-in-out infinite alternate;
    pointer-events: none;
  }
  .cfp-hero::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(148,163,184,.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148,163,184,.05) 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(70% 70% at 50% 40%, #000 20%, transparent 100%);
    mask-image: radial-gradient(70% 70% at 50% 40%, #000 20%, transparent 100%);
    pointer-events: none;
  }
  @keyframes cfp-drift {
    from { transform: translate3d(-1.5%, -1%, 0) scale(1); }
    to   { transform: translate3d(1.5%, 1.5%, 0) scale(1.04); }
  }
  @media (prefers-reduced-motion: reduce) { .cfp-hero::before { animation: none; } }

  .cfp-hero-bar {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: clamp(20px, 4vw, 40px) clamp(20px, 5vw, 56px) 0;
  }
  .cfp-hero-logo { height: clamp(30px, 4.5vw, 38px); width: auto; }
  .cfp-hero-meta { text-align: right; display: flex; flex-direction: column; gap: 2px; }
  .cfp-hero-ref { font-size: 13px; font-weight: 700; letter-spacing: .5px; color: #e2e8f0; font-family: var(--font-geist-mono, Consolas), monospace; }
  .cfp-hero-date { font-size: 11px; color: #64748b; }

  .cfp-hero-body {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 48px clamp(20px, 5vw, 56px);
    max-width: 980px;
  }
  .cfp-hero-item {
    opacity: 0;
    animation: cfp-up .8s cubic-bezier(.2,.65,.25,1) forwards;
  }
  @keyframes cfp-up {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cfp-hero-item { animation: none; opacity: 1; }
  }

  .cfp-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 4px;
    color: #94a3b8;
    margin: 0 0 14px;
  }
  .cfp-hero-title {
    font-size: clamp(38px, 7.5vw, 76px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.06;
    margin: 0;
  }
  .cfp-hero-site { display: block; color: #64748b; }
  .cfp-hero-address { font-size: clamp(14px, 2vw, 17px); color: #94a3b8; margin: 14px 0 0; }
  .cfp-hero-rule { width: 52px; height: 3px; background: #fff; margin: 26px 0; }
  .cfp-hero-lead {
    font-size: clamp(15px, 2.2vw, 18px);
    color: #cbd5e1;
    line-height: 1.7;
    max-width: 560px;
    margin: 0 0 26px;
  }
  .cfp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .cfp-chip {
    border: 1px solid #334155;
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 12.5px;
    color: #e2e8f0;
    background: rgba(30,41,59,.35);
    backdrop-filter: blur(2px);
  }

  .cfp-scroll-cue {
    position: relative;
    z-index: 1;
    align-self: center;
    margin-bottom: 26px;
    color: #64748b;
    animation: cfp-up .8s cubic-bezier(.2,.65,.25,1) forwards;
    opacity: 0;
  }
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
    padding: clamp(40px, 7vw, 72px) 0;
  }
  .cfp-stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
  }
  .cfp-stat { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
  .cfp-stat-n {
    font-size: clamp(34px, 5.5vw, 56px);
    font-weight: 800;
    color: #fff;
    letter-spacing: -0.02em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .cfp-stat-label { font-size: 10.5px; font-weight: 700; letter-spacing: 1.6px; color: #64748b; }
  @media (max-width: 640px) {
    .cfp-stats-grid { grid-template-columns: repeat(2, 1fr); gap: 32px 16px; }
  }

  /* ── Sections ── */
  .cfp-section { padding: clamp(64px, 10vw, 116px) 0; }
  .cfp-light { background: #f8fafc; }
  .cfp-white { background: #ffffff; }
  .cfp-dark  { background: #0f172a; }

  .cfp-h2 {
    font-size: clamp(27px, 4.4vw, 42px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: #0f172a;
    margin: 0 0 22px;
  }
  .cfp-h3 { font-size: clamp(19px, 2.6vw, 24px); font-weight: 700; letter-spacing: -0.01em; color: #0f172a; margin: 0 0 18px; }
  .cfp-h2-dark, .cfp-para-dark strong { color: #fff; }
  .cfp-kicker-dark { color: #64748b; }
  .cfp-para {
    font-size: clamp(15px, 2vw, 17px);
    color: #334155;
    line-height: 1.75;
    max-width: 760px;
    margin: 0 0 16px;
  }
  .cfp-para-dark { color: #cbd5e1; }
  .cfp-sublabel { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin: 44px 0 16px; }

  .cfp-brands { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 36px; }
  .cfp-brand { display: flex; flex-direction: column; gap: 2px; }
  .cfp-brand-name { font-size: 16px; font-weight: 700; color: #0f172a; }
  .cfp-brand-count { font-size: 13px; color: #64748b; }
  @media (max-width: 640px) { .cfp-brands { grid-template-columns: repeat(2, 1fr); gap: 18px 12px; } }

  .cfp-award {
    background: #0f172a;
    border-radius: 14px;
    padding: 22px 26px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
  }
  .cfp-award-kicker { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin: 0 0 5px; }
  .cfp-award-title { font-size: clamp(15px, 2.2vw, 18px); font-weight: 700; color: #fff; margin: 0; }
  .cfp-award-licences { font-size: 12px; color: #94a3b8; text-align: right; max-width: 46%; line-height: 1.6; margin: 0; }
  @media (max-width: 640px) {
    .cfp-award { flex-direction: column; align-items: flex-start; gap: 14px; }
    .cfp-award-licences { text-align: left; max-width: none; }
  }

  /* ── Differentiators ── */
  .cfp-diffs { display: flex; flex-direction: column; }
  .cfp-diff {
    display: flex;
    gap: clamp(16px, 3vw, 34px);
    padding: 26px 0;
    border-bottom: 1px solid #e2e8f0;
  }
  .cfp-diff:last-child { border-bottom: none; }
  .cfp-diff-num {
    font-size: clamp(22px, 3vw, 30px);
    font-weight: 800;
    color: #cbd5e1;
    line-height: 1.1;
    min-width: 52px;
    font-variant-numeric: tabular-nums;
  }
  .cfp-diff-title { font-size: clamp(17px, 2.4vw, 21px); font-weight: 700; color: #0f172a; margin: 0 0 6px; }
  .cfp-diff-body { font-size: clamp(14px, 1.9vw, 16px); color: #475569; line-height: 1.7; margin: 0; max-width: 720px; }

  /* ── Support cards + pills ── */
  .cfp-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 30px; }
  .cfp-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-top: 3px solid #0f172a;
    border-radius: 12px;
    padding: 22px;
  }
  .cfp-card-title { font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 8px; }
  .cfp-card-body { font-size: 14px; color: #475569; line-height: 1.65; margin: 0; }
  @media (max-width: 760px) { .cfp-cards { grid-template-columns: 1fr; } }

  .cfp-pills { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .cfp-pill {
    border: 1px solid #e2e8f0;
    background: #fff;
    border-radius: 10px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .cfp-pill-name { font-size: 14.5px; font-weight: 700; color: #0f172a; }
  .cfp-pill-desc { font-size: 13px; color: #64748b; line-height: 1.55; }
  @media (max-width: 640px) { .cfp-pills { grid-template-columns: 1fr; } }

  /* ── NBN ── */
  .cfp-nbn {
    border: 1px solid #1e293b;
    border-radius: 14px;
    overflow: hidden;
    margin-top: 14px;
  }
  .cfp-nbn-row {
    display: grid;
    grid-template-columns: 1.2fr 1.1fr auto;
    gap: 16px;
    align-items: center;
    padding: 18px 22px;
    border-bottom: 1px solid #1e293b;
    background: rgba(30,41,59,.25);
  }
  .cfp-nbn-row:last-child { border-bottom: none; }
  .cfp-nbn-plan, .cfp-nbn-speed, .cfp-nbn-price { display: flex; flex-direction: column; gap: 2px; }
  .cfp-nbn-name { font-size: 16px; font-weight: 700; color: #fff; }
  .cfp-nbn-fit { font-size: 12px; color: #94a3b8; line-height: 1.45; }
  .cfp-nbn-mbps { font-size: 15px; font-weight: 700; color: #e2e8f0; font-variant-numeric: tabular-nums; }
  .cfp-nbn-evening { font-size: 11.5px; color: #64748b; }
  .cfp-nbn-price { text-align: right; align-items: flex-end; }
  .cfp-nbn-dollars { font-size: 22px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
  .cfp-nbn-tail { font-size: 10.5px; color: #64748b; }
  @media (max-width: 640px) {
    .cfp-nbn-row { grid-template-columns: 1fr auto; }
    .cfp-nbn-speed { grid-column: 1 / -1; flex-direction: row; gap: 10px; align-items: baseline; }
  }
  .cfp-footnote { font-size: 12px; color: #64748b; line-height: 1.6; margin: 16px 0 0; max-width: 820px; }
  .cfp-standards { font-size: 11px; letter-spacing: .4px; color: #475569; margin: 34px 0 0; line-height: 1.7; }

  /* ── Testimonials ── */
  .cfp-testimonials { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 8px; }
  .cfp-tcard {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 24px;
    margin: 0;
  }
  .cfp-tmark { font-size: 34px; font-weight: 800; color: #cbd5e1; line-height: 1; display: block; margin-bottom: 6px; }
  .cfp-tquote { font-size: 14.5px; color: #334155; line-height: 1.7; font-style: italic; margin: 0; }
  .cfp-twho { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 14px; }
  @media (max-width: 720px) { .cfp-testimonials { grid-template-columns: 1fr; } }

  /* ── Transition band ── */
  .cfp-transition {
    background: #0f172a;
    padding: clamp(64px, 9vw, 104px) 0 clamp(56px, 8vw, 88px);
    border-bottom: 1px solid #1e293b;
  }
  .cfp-transition .cfp-h2-dark { max-width: 860px; }
  .cfp-pdf-link { color: #93c5fd; text-decoration: underline; text-underline-offset: 3px; }

  /* ── Quote section — sticky respond bar stays offstage until reached ── */
  .cfp-quote .qr-sticky { transition: transform .5s cubic-bezier(.2,.8,.2,1); }
  .cfp-offstage .qr-sticky { transform: translateY(140%); }
  @media (prefers-reduced-motion: reduce) {
    .cfp-quote .qr-sticky { transition: none; }
    .cfp-offstage .qr-sticky { transform: none; }
  }
`;
