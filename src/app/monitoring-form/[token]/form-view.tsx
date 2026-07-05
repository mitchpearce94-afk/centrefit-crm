"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignaturePad } from "@/components/ui/signature-pad";
import {
  ANNUAL_SERVICING_TEXT,
  AUTHORISATION_TEXT,
  CF_ABN,
  CF_ADDRESS,
  CF_ASIAL_MEMBERSHIP,
  CF_CONTROL_ROOM_PHONE,
  CF_SECURITY_LICENCE,
  CF_SERVICE_PHONE,
  CF_SUPPORT_EMAIL,
  DAY_LABELS,
  FORM_INTRO_TEXT,
  FORM_SECTIONS,
  LIABILITY_CLAUSES,
  OPTION_GROUPS,
  REISSUE_NOTE,
  SIM_SUPPLY_INTRO,
  TIME_SCHEDULE_NOTE,
  WEEK_DAYS,
  buildEmptyOpeningHours,
  calcFeeTotals,
  emptyDayHours,
  fmtAud,
  isMaskedPin,
  padCallList,
  padIfobUsers,
  type MonitoringDetails,
  type MonitoringFee,
  type MonitoringPrefill,
  type MonitoringSelections,
  type OptionGroup,
} from "@/lib/monitoring-form/spec";

/**
 * The customer-facing fillable form. Everything the CRM already knows is
 * pre-filled from the generation-time snapshot; the customer completes the
 * response selections, call list, iFob users and opening hours, then signs
 * on glass. Section visibility is tracked (IntersectionObserver) as the
 * digital replacement for per-page initialling — the audit block in the
 * signed PDF records when each section was brought into view.
 */

interface Props {
  token: string;
  status: "sent" | "viewed" | "signed";
  prefill: MonitoringPrefill;
  signedAt: string | null;
  signerName: string | null;
}

export function MonitoringFormView({ token, status, prefill, signedAt, signerName: signedBy }: Props) {
  const [details, setDetails] = useState<MonitoringDetails>(() => ({ ...prefill.details }));
  const [selections, setSelections] = useState<MonitoringSelections>(() => ({ ...prefill.selections }));
  const [callList, setCallList] = useState(() => padCallList(prefill.callList));
  const [ifobUsers, setIfobUsers] = useState(() => padIfobUsers(prefill.ifobUsers));
  const [hours, setHours] = useState(() => ({ ...buildEmptyOpeningHours(), ...prefill.openingHours }));
  const [signature, setSignature] = useState<string | null>(null);
  const [signName, setSignName] = useState(prefill.details.billingContactName ?? "");
  const [signPosition, setSignPosition] = useState("");
  const [sectionsViewed, setSectionsViewed] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState(status === "signed");

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const viewedRef = useRef<Record<string, string>>({});

  // Section-view audit — the digital stand-in for initialling each page.
  useEffect(() => {
    if (done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.section;
          if (key && entry.isIntersecting && !viewedRef.current[key]) {
            viewedRef.current[key] = new Date().toISOString();
            changed = true;
          }
        }
        if (changed) setSectionsViewed({ ...viewedRef.current });
      },
      { threshold: 0.25 },
    );
    for (const el of Object.values(sectionRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [done]);

  const registerSection = useCallback((key: string) => {
    return (el: HTMLElement | null) => {
      sectionRefs.current[key] = el;
    };
  }, []);

  const totals = useMemo(
    () => calcFeeTotals(selections, ifobUsers, prefill.fees),
    [selections, ifobUsers, prefill.fees],
  );

  const viewedCount = FORM_SECTIONS.filter((s) => sectionsViewed[s.key]).length;

  function setSelection(key: keyof MonitoringSelections, value: string) {
    setSelections((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string[] {
    const issues: string[] = [];
    if (!details.clientName.trim()) issues.push("Client name is required.");
    if (!details.email.trim()) issues.push("Email address is required.");
    if (!callList.some((r) => r.name.trim() && r.phone.trim())) {
      issues.push("At least one alarm response call list contact is required.");
    }
    for (let i = 0; i < ifobUsers.length; i++) {
      const u = ifobUsers[i];
      if (u.name.trim() && !isMaskedPin(u.pin) && !/^\d{4}$/.test(u.pin.trim())) {
        issues.push(`iFob user ${i + 1} (${u.name.trim()}) needs a 4-digit PIN.`);
      }
    }
    const requiredGroups: Array<{ key: keyof MonitoringSelections; title: string; skip247?: boolean }> = [
      { key: "late_to_close", title: "Late to Close", skip247: true },
      { key: "out_of_hours", title: "Out of Hours Entry", skip247: true },
      { key: "holdup", title: "Hold Up & Duress Alarms" },
      { key: "sim_supply", title: "Duress Intercom SIM Card" },
      { key: "burglar", title: "Burglar / Intruder Alarms" },
      { key: "apply_scope", title: "Instruction Scope" },
      { key: "vav", title: "Video Alarm Verification" },
      { key: "power_fail", title: "Power Fail" },
      { key: "battery_fail", title: "Battery Fail" },
    ];
    for (const g of requiredGroups) {
      if (g.skip247 && details.facility247) continue;
      if (!selections[g.key]) issues.push(`Please choose an option under “${g.title}”.`);
    }
    const unviewed = FORM_SECTIONS.filter((s) => !sectionsViewed[s.key]);
    if (unviewed.length > 0) {
      issues.push(
        `Please review every section before signing — still to view: ${unviewed.map((s) => s.title).join(", ")}.`,
      );
    }
    if (!signName.trim()) issues.push("Please print your name in the authorisation section.");
    if (!signPosition.trim()) issues.push("Please enter your position in the authorisation section.");
    if (!signature) issues.push("Please sign in the signature box.");
    return issues;
  }

  async function submit() {
    const issues = validate();
    setProblems(issues);
    if (issues.length > 0) {
      document.getElementById("mf-problems")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/monitoring-form/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formData: {
            details,
            selections,
            callList,
            ifobUsers,
            openingHours: hours,
            sectionsViewed: viewedRef.current,
          },
          signerName: signName.trim(),
          signerPosition: signPosition.trim(),
          signature,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Something went wrong submitting the form.");
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setProblems([err instanceof Error ? err.message : "Something went wrong submitting the form."]);
      document.getElementById("mf-problems")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Shell docVersion={prefill.docVersion}>
        <div className="mf-card" style={{ textAlign: "center", padding: "48px 32px" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#dcfce7", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 10px" }}>Instructions signed</h1>
          <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.7, margin: 0 }}>
            Your Security Monitoring Response Instructions for <strong>{prefill.siteName}</strong> have been
            received{signedBy ? <> — signed by <strong>{signedBy}</strong></> : null}
            {signedAt ? ` on ${new Date(signedAt).toLocaleDateString("en-AU")}` : ""}.
            A signed PDF copy has been emailed to you for your records.
          </p>
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, margin: "16px 0 0" }}>
            Need to change these instructions later? Contact Centrefit on {CF_SERVICE_PHONE} and we&apos;ll
            issue a fresh form.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell docVersion={prefill.docVersion}>
      {/* Title */}
      <div className="mf-card">
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 6px", letterSpacing: "-0.4px" }}>
          Client Information &amp; Security Monitoring Response Instructions
        </h1>
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px", fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>
          Commercial Clients · {prefill.siteName} · Version {prefill.docVersion}
        </p>
        <p className="mf-body">{FORM_INTRO_TEXT}</p>
        {prefill.isReissue && (
          <div className="mf-note" style={{ marginTop: 14 }}>{REISSUE_NOTE}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", marginTop: 16, fontSize: 12, color: "#64748b" }}>
          <span><strong style={{ color: "#334155" }}>ABN</strong> {CF_ABN}</span>
          <span><strong style={{ color: "#334155" }}>Security Licence</strong> {CF_SECURITY_LICENCE}</span>
          <span><strong style={{ color: "#334155" }}>ASIAL Membership</strong> {CF_ASIAL_MEMBERSHIP}</span>
          <span><strong style={{ color: "#334155" }}>Control Room 24/7</strong> {CF_CONTROL_ROOM_PHONE}</span>
          <span><strong style={{ color: "#334155" }}>Support</strong> {CF_SUPPORT_EMAIL}</span>
        </div>
      </div>

      {/* Client details */}
      <Section sectionKey="details" title="Client Details" registerSection={registerSection} viewed={!!sectionsViewed.details}>
        <div className="mf-grid2">
          <Field label="Client / Entity Name" value={details.clientName} onChange={(v) => setDetails({ ...details, clientName: v })} />
          <Field label="Billing Contact Name" value={details.billingContactName} onChange={(v) => setDetails({ ...details, billingContactName: v })} />
          <Field label="ABN" value={details.abn} onChange={(v) => setDetails({ ...details, abn: v })} />
          <Field label="Facility Name" value={details.facilityName} onChange={(v) => setDetails({ ...details, facilityName: v })} />
          <Field label="Facility Address" value={details.facilityAddress} onChange={(v) => setDetails({ ...details, facilityAddress: v })} wide />
          <Field label="Facility Phone Number" value={details.facilityPhone} onChange={(v) => setDetails({ ...details, facilityPhone: v })} />
          <Field label="Billing Address" value={details.billingAddress} onChange={(v) => setDetails({ ...details, billingAddress: v })} />
          <Field label="Nearest Cross Street" value={details.nearestCrossStreet} onChange={(v) => setDetails({ ...details, nearestCrossStreet: v })} />
          <Field label="Email" value={details.email} onChange={(v) => setDetails({ ...details, email: v })} type="email" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 16, alignItems: "center" }}>
          <label className="mf-check">
            <input type="checkbox" checked={details.newClient} onChange={(e) => setDetails({ ...details, newClient: e.target.checked })} />
            New client
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155" }}>
            Commencement date
            <input
              type="date"
              className="mf-input"
              style={{ width: 160 }}
              value={details.commencementDate}
              onChange={(e) => setDetails({ ...details, commencementDate: e.target.value })}
            />
          </label>
        </div>
      </Section>

      {/* Call list */}
      <Section
        sectionKey="call_list"
        title="Alarm Response Call List"
        subtitle="Call list recipients MUST be prepared to answer their mobiles after hours."
        registerSection={registerSection}
        viewed={!!sectionsViewed.call_list}
      >
        <div className="mf-grid2">
          {callList.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#94a3b8", width: 16, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
              <input
                className="mf-input"
                placeholder="Name"
                value={row.name}
                onChange={(e) => {
                  const next = [...callList];
                  next[i] = { ...row, name: e.target.value };
                  setCallList(next);
                }}
              />
              <input
                className="mf-input"
                placeholder="Phone number"
                type="tel"
                value={row.phone}
                onChange={(e) => {
                  const next = [...callList];
                  next[i] = { ...row, phone: e.target.value };
                  setCallList(next);
                }}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* iFob users */}
      <Section
        sectionKey="ifob"
        title="iFob App Access"
        subtitle="Identify each user with a unique 4-digit PIN and choose whether they get iFob mobile app access (iOS and Android)."
        registerSection={registerSection}
        viewed={!!sectionsViewed.ifob}
      >
        {prefill.isReissue && (
          <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
            Existing PINs show as ***X — leave them as they are to keep the current PIN, or type a new 4-digit PIN to change it.
          </p>
        )}
        <div className="mf-grid2">
          {ifobUsers.map((u, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#94a3b8", width: 16, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
              <input
                className="mf-input"
                placeholder="Full name"
                value={u.name}
                onChange={(e) => {
                  const next = [...ifobUsers];
                  next[i] = { ...u, name: e.target.value };
                  setIfobUsers(next);
                }}
              />
              <input
                className="mf-input"
                placeholder="PIN"
                inputMode="numeric"
                maxLength={4}
                style={{ width: 72, flexShrink: 0, textAlign: "center", fontFamily: "Consolas, monospace" }}
                value={u.pin}
                onFocus={(e) => {
                  if (isMaskedPin(u.pin)) e.target.select();
                }}
                onChange={(e) => {
                  const next = [...ifobUsers];
                  next[i] = { ...u, pin: e.target.value };
                  setIfobUsers(next);
                }}
              />
              <button
                type="button"
                className={u.app_access ? "mf-toggle mf-toggle-on" : "mf-toggle"}
                onClick={() => {
                  const next = [...ifobUsers];
                  next[i] = { ...u, app_access: !u.app_access };
                  setIfobUsers(next);
                }}
              >
                App {u.app_access ? "Yes" : "No"}
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Opening hours */}
      <Section
        sectionKey="hours"
        title="Hours of Earliest Opening & Latest Closing"
        subtitle="The earliest time you will arrive on site and the latest time you will leave site. For 24/7 facilities, tick 24-hour instead."
        registerSection={registerSection}
        viewed={!!sectionsViewed.hours}
      >
        <label className="mf-check" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={details.facility247}
            onChange={(e) => {
              const on = e.target.checked;
              setDetails({ ...details, facility247: on });
              if (on) {
                const next = { ...hours };
                for (const d of WEEK_DAYS) next[d] = { ...(next[d] ?? emptyDayHours()), h24: true };
                setHours(next);
                setSelections((prev) => ({ ...prev, late_to_close: undefined, out_of_hours: undefined }));
              }
            }}
          />
          This facility operates 24/7
        </label>
        <div style={{ overflowX: "auto" }}>
          <table className="mf-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Time Schedule</th>
                {WEEK_DAYS.map((d) => <th key={d}>{DAY_LABELS[d]}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                { label: "Opening time", field: "open" as const, type: "time" },
                { label: "Closing time", field: "close" as const, type: "time" },
                { label: "Cleaner times", field: "cleaner" as const, type: "text" },
              ]).map((rowDef) => (
                <tr key={rowDef.field}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600, color: "#334155" }}>{rowDef.label}</td>
                  {WEEK_DAYS.map((d) => (
                    <td key={d}>
                      <input
                        className="mf-input"
                        style={{ minWidth: rowDef.type === "time" ? 96 : 88, padding: "6px 8px", fontSize: 12 }}
                        type={rowDef.type}
                        disabled={hours[d]?.h24}
                        value={hours[d]?.[rowDef.field] ?? ""}
                        onChange={(e) => {
                          setHours({ ...hours, [d]: { ...(hours[d] ?? emptyDayHours()), [rowDef.field]: e.target.value } });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td style={{ whiteSpace: "nowrap", fontWeight: 600, color: "#334155" }}>24-hour facility</td>
                {WEEK_DAYS.map((d) => (
                  <td key={d} style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={hours[d]?.h24 ?? false}
                      onChange={(e) => {
                        setHours({ ...hours, [d]: { ...(hours[d] ?? emptyDayHours()), h24: e.target.checked } });
                      }}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mf-note" style={{ marginTop: 12 }}>{TIME_SCHEDULE_NOTE}</div>
      </Section>

      {/* Response option groups, with the SIM section slotted after Hold Up (matching the paper order) */}
      {OPTION_GROUPS.map((group) => (
        <FragmentWithSim
          key={group.key}
          group={group}
          selections={selections}
          setSelection={setSelection}
          details={details}
          setDetails={setDetails}
          prefill={prefill}
          registerSection={registerSection}
          sectionsViewed={sectionsViewed}
        />
      ))}

      {/* Annual servicing */}
      <Section sectionKey="servicing" title="Annual Servicing of Security System" registerSection={registerSection} viewed={!!sectionsViewed.servicing}>
        <p className="mf-body">{ANNUAL_SERVICING_TEXT}</p>
      </Section>

      {/* Fees */}
      <Section
        sectionKey="fees"
        title="Fees & Ongoing Costs"
        subtitle="Based on the options you have selected above. All figures ex GST with inc GST in brackets."
        registerSection={registerSection}
        viewed={!!sectionsViewed.fees}
      >
        {totals.lines.length === 0 ? (
          <p className="mf-body">Make your selections above to see the applicable fees.</p>
        ) : (
          <div>
            {totals.lines.map((line) => (
              <div key={line.fee.code} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13.5, color: "#334155" }}>
                <span>{line.label}</span>
                <span style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                  ${fmtAud(line.fee.priceExGst)} ex GST (${fmtAud(line.fee.priceIncGst)} inc) / {line.fee.frequency === "monthly" ? "month" : "year"}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "14px 0 0", fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
              <span>Monthly total</span>
              <span>${fmtAud(totals.monthlyExGst)} ex GST (${fmtAud(totals.monthlyIncGst)} inc)</span>
            </div>
            {totals.yearlyExGst > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0 0", fontSize: 13.5, fontWeight: 600, color: "#334155" }}>
                <span>Plus annually</span>
                <span>${fmtAud(totals.yearlyExGst)} ex GST (${fmtAud(totals.yearlyIncGst)} inc)</span>
              </div>
            )}
          </div>
        )}
        {prefill.fees.nbn && (
          <div className="mf-note" style={{ marginTop: 14 }}>
            An internet service is required prior to the system being installed. This can be supplied by
            you, or Centrefit Communications can supply a business NBN plan ({prefill.fees.nbn.name}) at
            ${fmtAud(prefill.fees.nbn.priceIncGst)}/month ongoing — Bronze SLA remote support and VPN
            access included.
          </div>
        )}
      </Section>

      {/* Liability */}
      <Section sectionKey="liability" title="Liability Exclusion Schedule" registerSection={registerSection} viewed={!!sectionsViewed.liability}>
        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 12 }}>
          {LIABILITY_CLAUSES.map((clause, i) => (
            <li key={i} className="mf-body" style={{ fontSize: 12.5 }}>{clause}</li>
          ))}
        </ol>
      </Section>

      {/* Signature */}
      <Section sectionKey="sign" title="Authorisation & Signature" registerSection={registerSection} viewed={!!sectionsViewed.sign}>
        <p className="mf-body" style={{ fontWeight: 600, color: "#334155" }}>{AUTHORISATION_TEXT}</p>
        <div className="mf-grid2" style={{ marginTop: 16 }}>
          <Field label="Print Name" value={signName} onChange={setSignName} />
          <Field label="Position" value={signPosition} onChange={setSignPosition} />
        </div>
        <div style={{ marginTop: 16 }}>
          <span className="mf-label">Signature</span>
          <SignaturePad onChange={setSignature} />
        </div>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: "10px 0 0" }}>
          Date: {new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })} ·
          One signature authorises this entire document; the time each section was reviewed is recorded
          in the signed PDF&apos;s audit trail.
        </p>

        {problems.length > 0 && (
          <div id="mf-problems" style={{ marginTop: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px" }}>
            {problems.map((p, i) => (
              <p key={i} style={{ fontSize: 13, color: "#b91c1c", margin: i === 0 ? 0 : "6px 0 0" }}>{p}</p>
            ))}
          </div>
        )}

        <button type="button" className="mf-submit" disabled={submitting} onClick={submit}>
          {submitting ? "Submitting…" : "Sign & Submit Instructions"}
        </button>
      </Section>

      {/* Sticky progress footer */}
      <div className="mf-footer">
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {viewedCount}/{FORM_SECTIONS.length} sections reviewed
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
          Monthly: ${fmtAud(totals.monthlyExGst)} ex GST
        </span>
      </div>
    </Shell>
  );
}

// ── Option group section (with SIM card block slotted after Hold Up) ─────────

function FragmentWithSim({
  group,
  selections,
  setSelection,
  details,
  setDetails,
  prefill,
  registerSection,
  sectionsViewed,
}: {
  group: OptionGroup;
  selections: MonitoringSelections;
  setSelection: (key: keyof MonitoringSelections, value: string) => void;
  details: MonitoringDetails;
  setDetails: (d: MonitoringDetails) => void;
  prefill: MonitoringPrefill;
  registerSection: (key: string) => (el: HTMLElement | null) => void;
  sectionsViewed: Record<string, string>;
}) {
  const notApplicable = Boolean(group.optional247 && details.facility247);
  const groupFee: MonitoringFee | undefined = group.feeKey ? prefill.fees[group.feeKey] : undefined;

  const groupSection = (
    <Section
      sectionKey={group.key}
      title={group.title}
      subtitle={group.intro}
      registerSection={registerSection}
      viewed={!!sectionsViewed[group.key]}
    >
      {notApplicable && (
        <div className="mf-note" style={{ marginBottom: 12 }}>
          Not required — this facility operates 24/7.
        </div>
      )}
      <div style={{ display: "grid", gap: 10, opacity: notApplicable ? 0.45 : 1, pointerEvents: notApplicable ? "none" : undefined }}>
        {group.options.map((opt) => {
          const checked = selections[group.key] === opt.value;
          return (
            <label key={opt.value} className={checked ? "mf-option mf-option-on" : "mf-option"}>
              <input
                type="radio"
                name={`mf-${group.key}`}
                checked={checked}
                onChange={() => setSelection(group.key, opt.value)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 13.5 }}>{opt.label}</span>
                <span style={{ display: "block", marginTop: 4 }}>
                  {opt.lines.map((line, i) => (
                    <span key={i} style={{ display: "block", fontSize: 13, color: "#475569", lineHeight: 1.55 }}>
                      {line}
                    </span>
                  ))}
                </span>
                {group.key === "vav" && opt.value !== "C3" && groupFee && (
                  <span style={{ display: "inline-block", marginTop: 6, fontSize: 12, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px" }}>
                    VAV subscription ${fmtAud(groupFee.priceExGst)} ex GST (${fmtAud(groupFee.priceIncGst)} inc) / month
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {group.warning && !notApplicable && (
        <div className="mf-warning" style={{ marginTop: 12 }}>{group.warning}</div>
      )}
    </Section>
  );

  // The paper form places the SIM supply block between Hold Up and Burglar.
  if (group.key !== "holdup") return groupSection;

  const simFee = prefill.fees.sim;
  return (
    <>
      {groupSection}
      <Section
        sectionKey="sim"
        title="Duress Intercom SIM Card"
        subtitle={SIM_SUPPLY_INTRO}
        registerSection={registerSection}
        viewed={!!sectionsViewed.sim}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label className={selections.sim_supply === "centrefit" ? "mf-option mf-option-on" : "mf-option"}>
            <input
              type="radio"
              name="mf-sim"
              checked={selections.sim_supply === "centrefit"}
              onChange={() => setSelection("sim_supply", "centrefit")}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 13.5 }}>Centrefit to supply SIM card</span>
              {simFee && (
                <span style={{ display: "block", fontSize: 13, color: "#475569", marginTop: 4 }}>
                  ${fmtAud(simFee.priceExGst)} ex GST (${fmtAud(simFee.priceIncGst)} inc) per month.
                </span>
              )}
            </span>
          </label>
          <label className={selections.sim_supply === "client" ? "mf-option mf-option-on" : "mf-option"}>
            <input
              type="radio"
              name="mf-sim"
              checked={selections.sim_supply === "client"}
              onChange={() => setSelection("sim_supply", "client")}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 13.5 }}>I will purchase the SIM card</span>
              <span style={{ display: "block", fontSize: 13, color: "#475569", marginTop: 4 }}>
                A 4G postpaid phone SIM is required for each duress intercom.
              </span>
            </span>
          </label>
        </div>
        {selections.sim_supply === "client" && (
          <div style={{ marginTop: 12, maxWidth: 320 }}>
            <Field
              label="SIM Card Phone Number"
              value={details.simPhone}
              onChange={(v) => setDetails({ ...details, simPhone: v })}
              type="tel"
            />
          </div>
        )}
      </Section>
    </>
  );
}

// ── Layout primitives ────────────────────────────────────────────────────────

function Shell({ children, docVersion }: { children: React.ReactNode; docVersion: number }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", paddingBottom: 80 }}>
      <style>{MF_CSS}</style>
      <header style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", padding: "20px 20px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/centrefit-logo-white.png" alt="Centrefit Group" style={{ height: 34, width: "auto", display: "block" }} />
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 10, color: "#94a3b8", margin: 0, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>Security Monitoring</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#60a5fa", margin: "2px 0 0", fontFamily: "Consolas, monospace" }}>v{docVersion}</p>
          </div>
        </div>
      </header>
      <main style={{ maxWidth: 780, margin: "0 auto", padding: "20px 16px 40px", display: "grid", gap: 16 }}>
        {children}
      </main>
      <footer style={{ textAlign: "center", padding: "0 16px 100px", fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
        Centrefit Group Pty Ltd · ABN {CF_ABN} · {CF_ADDRESS} · {CF_SERVICE_PHONE}
      </footer>
    </div>
  );
}

function Section({
  sectionKey,
  title,
  subtitle,
  children,
  registerSection,
  viewed,
}: {
  sectionKey: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  registerSection: (key: string) => (el: HTMLElement | null) => void;
  viewed: boolean;
}) {
  return (
    <section className="mf-card" data-section={sectionKey} ref={registerSection(sectionKey)}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: subtitle ? 4 : 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: 0, letterSpacing: "-0.2px" }}>{title}</h2>
        {viewed && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ✓ Reviewed
          </span>
        )}
      </div>
      {subtitle && <p style={{ fontSize: 12.5, color: "#64748b", margin: "0 0 14px", lineHeight: 1.55 }}>{subtitle}</p>}
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  wide?: boolean;
}) {
  return (
    <label style={{ display: "block", gridColumn: wide ? "1 / -1" : undefined }}>
      <span className="mf-label">{label}</span>
      <input className="mf-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const MF_CSS = `
.mf-card { background:#ffffff; border-radius:14px; padding:24px; box-shadow:0 1px 3px rgba(15,23,42,0.08); }
.mf-body { font-size:13px; color:#475569; line-height:1.65; margin:0; }
.mf-label { display:block; font-size:11px; font-weight:700; color:#64748b; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:5px; }
.mf-input { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:8px; padding:9px 12px; font-size:13.5px; color:#0f172a; background:#ffffff; font-family:inherit; }
.mf-input:focus { outline:2px solid #3b82f6; outline-offset:-1px; border-color:#3b82f6; }
.mf-input:disabled { background:#f8fafc; color:#94a3b8; }
.mf-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px 16px; }
@media (max-width:640px){ .mf-grid2 { grid-template-columns:1fr; } }
.mf-check { display:flex; align-items:center; gap:8px; font-size:13px; color:#334155; font-weight:600; cursor:pointer; }
.mf-note { background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 14px; font-size:12.5px; color:#1e40af; line-height:1.55; }
.mf-warning { background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px 14px; font-size:12.5px; color:#92400e; line-height:1.55; font-weight:600; }
.mf-option { display:flex; gap:12px; align-items:flex-start; border:1.5px solid #e2e8f0; border-radius:12px; padding:14px 16px; cursor:pointer; transition:border-color .15s, background .15s; }
.mf-option:hover { border-color:#93c5fd; }
.mf-option-on { border-color:#3b82f6; background:#eff6ff; }
.mf-toggle { flex-shrink:0; border:1.5px solid #e2e8f0; background:#ffffff; color:#94a3b8; border-radius:8px; padding:7px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; font-family:inherit; }
.mf-toggle-on { border-color:#16a34a; background:#f0fdf4; color:#15803d; }
.mf-table { border-collapse:collapse; width:100%; }
.mf-table th { font-size:11px; color:#64748b; font-weight:700; padding:6px 6px; text-align:center; }
.mf-table td { padding:5px 6px; }
.mf-submit { display:block; width:100%; margin-top:20px; background:#3b82f6; color:#ffffff; border:none; border-radius:12px; padding:16px; font-size:15px; font-weight:700; cursor:pointer; font-family:inherit; letter-spacing:0.2px; }
.mf-submit:hover { background:#2563eb; }
.mf-submit:disabled { opacity:0.6; cursor:default; }
.mf-footer { position:fixed; left:0; right:0; bottom:0; background:rgba(255,255,255,0.96); backdrop-filter:blur(8px); border-top:1px solid #e2e8f0; padding:12px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; max-width:100%; }
`;
