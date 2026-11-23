import type { ScopeDocument } from './scope-of-works'

/**
 * Subcontractor scope on a quote (Mitchell, 23 Nov 2026 — Snap Fitness Moffat
 * Beach: Dane / DWP Electrical quoted the lighting, power, data & TV and
 * testing; Centrefit carries it on the one quote but it must be "separated
 * definitively" from Centrefit's own scope and price).
 *
 * Stored as `quotes.subcontract` JSONB. Centrefit's own scope stays labelled as
 * normal; this block renders after it as "<label> — by <contractor>" with its
 * own lines, inclusions and total. Pricing: cost = the contractor's quoted ex-GST
 * figures, sell = cost × (1 + margin%). It is added to the quote total AFTER
 * Centrefit's uplift / discount / negotiated override, so those never touch the
 * contractor's part.
 */
export interface SubcontractLine {
  id: string
  name: string
  cost: number
  sell: number
}

export interface QuoteSubcontract {
  /** Who does the work — printed on the customer documents. */
  contractor: string
  /** Section label — e.g. "Electrical & Lighting". */
  label: string
  /** Default margin applied when a line's cost is typed (sell stays editable). */
  marginPercent: number
  lines: SubcontractLine[]
  /** Free text; one inclusion per line, "- " prefix = bullet, blank line = paragraph break. */
  inclusions: string
}

export const DEFAULT_SUBCONTRACT_MARGIN = 30

export function emptySubcontract(): QuoteSubcontract {
  return { contractor: '', label: 'Electrical & Lighting', marginPercent: DEFAULT_SUBCONTRACT_MARGIN, lines: [], inclusions: '' }
}

export function sellFromCost(cost: number, marginPercent: number): number {
  return Math.round((Number(cost) || 0) * (1 + (Number(marginPercent) || 0) / 100) * 100) / 100
}

export function subcontractTotals(sub?: QuoteSubcontract | null): { cost: number; sell: number } {
  let cost = 0
  let sell = 0
  for (const l of sub?.lines ?? []) {
    cost += Number(l.cost) || 0
    sell += Number(l.sell) || 0
  }
  return { cost: Math.round(cost * 100) / 100, sell: Math.round(sell * 100) / 100 }
}

/** True when there is something to show / charge. */
export function hasSubcontract(sub?: QuoteSubcontract | null): sub is QuoteSubcontract {
  return !!sub && Array.isArray(sub.lines) && sub.lines.some((l) => (Number(l.sell) || 0) > 0 || (Number(l.cost) || 0) > 0)
}

/** Normalise whatever came out of JSONB / an old draft into a full object. */
export function normaliseSubcontract(raw: unknown): QuoteSubcontract | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<QuoteSubcontract>
  const lines = Array.isArray(r.lines)
    ? r.lines.map((l, i) => ({
        id: typeof l?.id === 'string' && l.id ? l.id : `sc_${i}`,
        name: String(l?.name ?? ''),
        cost: Number(l?.cost) || 0,
        sell: Number(l?.sell) || 0,
      }))
    : []
  return {
    contractor: String(r.contractor ?? ''),
    label: String(r.label ?? '') || 'Electrical & Lighting',
    marginPercent: Number.isFinite(Number(r.marginPercent)) ? Number(r.marginPercent) : DEFAULT_SUBCONTRACT_MARGIN,
    lines,
    inclusions: String(r.inclusions ?? ''),
  }
}

/** Customer-facing block carried on the ScopeDocument so every renderer (PDF, email text, customer HTML, job scope, Xero) prints the same thing. */
export interface ScopeSubcontractBlock {
  contractor: string
  label: string
  /** Section heading as printed: "ELECTRICAL & LIGHTING — BY DWP ELECTRICAL". */
  heading: string
  lines: { id: string; name: string; price: number }[]
  total: number
  /** Inclusion items in the scope-item convention: plain = bullet, <p>…</p> = paragraph. */
  items: string[]
}

export function subcontractToScopeBlock(sub?: QuoteSubcontract | null): ScopeSubcontractBlock | undefined {
  if (!hasSubcontract(sub)) return undefined
  const items: string[] = []
  for (const rawLine of (sub.inclusions || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const bullet = line.match(/^[-•*]\s+(.*)$/)
    items.push(bullet ? bullet[1] : `<p>${line}</p>`)
  }
  const { sell } = subcontractTotals(sub)
  const contractor = sub.contractor.trim()
  const label = sub.label.trim() || 'Electrical & Lighting'
  return {
    contractor,
    label,
    heading: contractor ? `${label} — by ${contractor}` : label,
    lines: sub.lines.filter((l) => (Number(l.sell) || 0) > 0 || l.name.trim()).map((l) => ({ id: l.id, name: l.name, price: Number(l.sell) || 0 })),
    total: sell,
    items,
  }
}

/** Attach the subcontractor block to a generated scope document (no-op when there is none). */
export function attachSubcontract<T extends ScopeDocument>(scope: T, sub?: unknown): T {
  const block = subcontractToScopeBlock(normaliseSubcontract(sub))
  if (!block) return scope
  // The generated scope assumes the electrician is the customer's: it carries a
  // blanket "no electrical works" exclusion and talks about the customer's
  // electrician. With a priced electrical section on the quote those read as
  // contradictions, so narrow them to "beyond the <section>".
  const who = block.contractor || 'the subcontractor'
  const hardExclusion = scope.hardExclusion
    ? `Electrical works beyond the "${block.heading}" section are not included in this quote.`.toUpperCase()
    : scope.hardExclusion
  const assumptions = scope.assumptions.map((a) => a.replace(/customer'?s electrician'?s/i, `${who}'s`).replace(/customer'?s electrician/i, who))
  return { ...scope, subcontract: block, hardExclusion, assumptions }
}
