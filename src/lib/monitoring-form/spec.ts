/**
 * Security Monitoring Response Instructions — shared spec.
 *
 * Single source of truth for the digital version of the paper form
 * "Client Information and Security Monitoring Response Instructions —
 * COMMERCIAL CLIENTS" (v17022026). The public web form, the generated PDF
 * and both API routes all render from these definitions so the wording can
 * never drift between what the customer selects and what gets signed.
 *
 * Fees are NEVER hardcoded here — they are snapshotted from the
 * recurring_services catalogue into the sign request's prefill at
 * generation time (docs/documentation-CONTEXT.md Phase B).
 */

// ── Company constants ───────────────────────────────────────────────────────

export const CF_ABN = "55 168 413 161";
export const CF_ADDRESS = "Unit 1, 25 Paisley Drive, Lawnton QLD 4501";
export const CF_SERVICE_PHONE = "(07) 3188 5115";
export const CF_SUPPORT_EMAIL = "support@centrefit.com.au";
export const CF_CONTROL_ROOM_PHONE = "(07) 3865 6175";
// Canonical licence constants (Mitchell confirmed 2026-07-05 — the security
// paperwork's set wins; the old handover template's 64951/C12897 is stale).
export const CF_SECURITY_LICENCE = "4626412";
export const CF_ASIAL_MEMBERSHIP = "64937";

/** Paper revision this digital form reproduces + our digital revision. */
export const TEMPLATE_VERSION = "v17022026-D1";

// ── Fee catalogue codes snapshotted at generation time ──────────────────────

export const FEE_CODES = {
  monitoring: "security-monitoring",
  app: "myalarm-app",
  vav: "VAV",
  sim: "sim-card",
  nbn: "nbn-100-40",
} as const;

export interface MonitoringFee {
  code: string;
  name: string;
  priceIncGst: number;
  priceExGst: number;
  frequency: "monthly" | "yearly";
}

export function feeFromIncGst(
  code: string,
  name: string,
  priceIncGst: number,
  frequency: "monthly" | "yearly",
): MonitoringFee {
  return {
    code,
    name,
    priceIncGst,
    priceExGst: Math.round((priceIncGst / 1.1) * 100) / 100,
    frequency,
  };
}

// ── Form data shapes ────────────────────────────────────────────────────────

export interface MonitoringSelections {
  late_to_close?: string;
  out_of_hours?: string;
  holdup?: string;
  sim_supply?: "centrefit" | "client";
  burglar?: string;
  apply_scope?: string;
  vav?: string;
  power_fail?: string;
  battery_fail?: string;
}

export interface CallListRow {
  name: string;
  phone: string;
}

export interface IfobUserRow {
  name: string;
  /** 4 digits, or a masked value (see maskPin) meaning "unchanged". */
  pin: string;
  app_access: boolean;
}

export interface DayHours {
  open: string;
  close: string;
  cleaner: string;
  h24: boolean;
}

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];
export type OpeningHours = Partial<Record<WeekDay, DayHours>>;

export const DAY_LABELS: Record<WeekDay, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

export interface MonitoringDetails {
  clientName: string;
  billingContactName: string;
  abn: string;
  facilityName: string;
  facilityAddress: string;
  facilityPhone: string;
  billingAddress: string;
  nearestCrossStreet: string;
  email: string;
  newClient: boolean;
  commencementDate: string;
  simPhone: string;
  /** Whole facility runs 24/7 — L + H groups become not applicable. */
  facility247: boolean;
}

export interface ZoneScheduleRow {
  zone: string;
  name: string;
  description: string;
}

/** Generation-time snapshot stored on document_sign_requests.prefill. */
export interface MonitoringPrefill {
  siteName: string;
  details: MonitoringDetails;
  selections: MonitoringSelections;
  callList: CallListRow[];
  ifobUsers: IfobUserRow[];
  openingHours: OpeningHours;
  zoneSchedule: ZoneScheduleRow[];
  fees: Partial<Record<keyof typeof FEE_CODES, MonitoringFee>>;
  isReissue: boolean;
  docVersion: number;
  generatedAt: string;
}

/** What the public form submits. */
export interface MonitoringFormData {
  details: MonitoringDetails;
  selections: MonitoringSelections;
  callList: CallListRow[];
  ifobUsers: IfobUserRow[];
  openingHours: OpeningHours;
  /** Section key → ISO timestamp the customer first brought it into view. */
  sectionsViewed: Record<string, string>;
}

// ── PIN masking ─────────────────────────────────────────────────────────────
//
// The site profile stores PINs masked (Mitchell approved storage on that
// basis) — the signed PDF held in the private bucket is the full record.
// A masked value round-trips through re-issued forms as "unchanged".

export function maskPin(pin: string): string {
  const t = pin.trim();
  if (!t) return "";
  return `***${t.slice(-1)}`;
}

export function isMaskedPin(pin: string): boolean {
  return /^\*{3}.$/.test(pin.trim());
}

// ── Response option groups (wording verbatim from the paper form) ───────────

export interface ResponseOption {
  value: string;
  label: string;
  lines: string[];
}

export interface OptionGroup {
  key: keyof MonitoringSelections;
  title: string;
  intro?: string;
  /** "For 24/7 Facilities, Leave Blank" applies to this group. */
  optional247?: boolean;
  options: ResponseOption[];
  warning?: string;
  /** Fee code that becomes payable through this group (shown inline). */
  feeKey?: keyof typeof FEE_CODES;
}

export const POLICE_FALSE_ALARM_WARNING =
  "PLEASE BE AWARE: If there is more than 1 false alarm within a 28-day period, the owner will be charged $1600 for every false alarm that police attend.";

export const OPTION_GROUPS: OptionGroup[] = [
  {
    key: "late_to_close",
    title: "Late to Close",
    intro: "Please choose the option that best suits your requirements.",
    optional247: true,
    options: [
      {
        value: "L1",
        label: "Option L1",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Remote Arm if Available. Note - Charges may be applied for Remote Arming.",
        ],
      },
      {
        value: "L2",
        label: "Option L2",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call Security Patrol. Note - Charges will apply for Security Patrol Car Attendance.",
        ],
      },
    ],
  },
  {
    key: "out_of_hours",
    title: "Out of Hours Entry",
    intro: "Please choose the option that best suits your requirements.",
    optional247: true,
    options: [
      {
        value: "H1",
        label: "Option H1",
        lines: ["Call Premises - No Answer.", "Call Alarm Response Call List in order."],
      },
      {
        value: "H2",
        label: "Option H2",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call Security Patrol. Note - Charges will apply for Security Patrol Car Attendance.",
        ],
      },
      {
        value: "H3",
        label: "Option H3",
        lines: [
          "No Action - when users with a valid PIN code disarm the alarm system outside the scheduled hours listed above, we will not take any action.",
        ],
      },
    ],
  },
  {
    key: "holdup",
    title: "Hold Up, Duress Alarms & Duress Intercom",
    intro:
      "Please choose the option that best suits your requirements. Note! Charges apply for Patrol Company attendance.",
    options: [
      {
        value: "P1",
        label: "Option P1",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Leave messages with Alarm Response Call List.",
        ],
      },
      {
        value: "P2",
        label: "Option P2",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call Security Patrol. Note - Charges will apply for Security Patrol Car Attendance.",
        ],
      },
      {
        value: "P3",
        label: "Option P3",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call the Police.",
        ],
      },
    ],
    warning: POLICE_FALSE_ALARM_WARNING,
  },
  {
    key: "burglar",
    title: "Burglar / Intruder Alarms",
    intro: "Please choose the option that best suits your requirements.",
    options: [
      {
        value: "B1",
        label: "Option B1",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Leave messages with Alarm Response Call List.",
        ],
      },
      {
        value: "B2",
        label: "Option B2",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call Security Patrol. Note - Charges will apply for Security Patrol Car Attendance.",
        ],
      },
      {
        value: "B3",
        label: "Option B3",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call the Police.",
        ],
      },
    ],
    warning: POLICE_FALSE_ALARM_WARNING,
  },
  {
    key: "apply_scope",
    title: "Apply These Instructions For",
    options: [
      { value: "A", label: "Option A", lines: ["All Alarms."] },
      {
        value: "B",
        label: "Option B",
        lines: [
          "Multiple Alarms Only - a multiple alarm is when 2 or more zones activate within a 10-minute period, or when any single zone activates 2 or more times within a 10-minute period.",
        ],
      },
    ],
  },
  {
    key: "vav",
    title: "Video Alarm Verification",
    intro:
      "CCTV Cameras Video Alarm Verification (VAV). Note! Must be a monitored security system and all camera footage is viewed live.",
    feeKey: "vav",
    options: [
      {
        value: "C1",
        label: "Option C1",
        lines: [
          "View cameras as soon as possible upon receipt of an alarm.",
          "No identifiable source of alarm from live footage - ignore alarm.",
          "Source identified - action as per Burglar alarm.",
        ],
      },
      {
        value: "C2",
        label: "Option C2",
        lines: [
          "View cameras as soon as possible upon receipt of an alarm.",
          "Action as per Burglar alarm on all occasions.",
        ],
      },
      {
        value: "C3",
        label: "Option C3",
        lines: ["No VAV (we will not access your cameras onsite to verify alarms)."],
      },
    ],
  },
  {
    key: "power_fail",
    title: "Power Fail",
    intro: "Please choose the option that best suits your requirements.",
    options: [
      {
        value: "AC1",
        label: "Option AC1",
        lines: [
          "After hours - leave until business hours.",
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order.",
        ],
      },
      {
        value: "AC2",
        label: "Option AC2",
        lines: ["Call Premises - No Answer.", "Call Alarm Response Call List in order."],
      },
      {
        value: "AC3",
        label: "Option AC3",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call Security Patrol. Note - Charges will apply for Security Patrol Car Attendance.",
        ],
      },
    ],
  },
  {
    key: "battery_fail",
    title: "Battery Fail",
    intro: "Please choose the option that best suits your requirements.",
    options: [
      {
        value: "BF1",
        label: "Option BF1",
        lines: [
          "After hours - leave until business hours.",
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order.",
        ],
      },
      {
        value: "BF2",
        label: "Option BF2",
        lines: ["Call Premises - No Answer.", "Call Alarm Response Call List in order."],
      },
      {
        value: "BF3",
        label: "Option BF3",
        lines: [
          "Call Premises - No Answer.",
          "Call Alarm Response Call List in order - No Answer.",
          "Call Security Patrol. Note - Charges will apply for Security Patrol Car Attendance.",
        ],
      },
    ],
  },
];

export const SIM_SUPPLY_INTRO =
  "As Centrefit Group supplies and installs a 4G Duress Intercom for two-way communication to our Control Room in the event of an incident, a SIM card is required for each Duress Intercom.";

// ── Sections (audit trail + form layout) ────────────────────────────────────

export interface FormSection {
  key: string;
  title: string;
}

export const FORM_SECTIONS: FormSection[] = [
  { key: "details", title: "Client Details" },
  { key: "call_list", title: "Alarm Response Call List" },
  { key: "ifob", title: "iFob App Access" },
  { key: "hours", title: "Opening & Closing Times" },
  { key: "late_to_close", title: "Late to Close" },
  { key: "out_of_hours", title: "Out of Hours Entry" },
  { key: "holdup", title: "Hold Up & Duress Alarms" },
  { key: "sim", title: "Duress Intercom SIM Card" },
  { key: "burglar", title: "Burglar / Intruder Alarms" },
  { key: "apply_scope", title: "Instruction Scope" },
  { key: "vav", title: "Video Alarm Verification" },
  { key: "power_fail", title: "Power Fail" },
  { key: "battery_fail", title: "Battery Fail" },
  { key: "servicing", title: "Annual Servicing" },
  { key: "fees", title: "Fees & Ongoing Costs" },
  { key: "liability", title: "Liability Exclusion Schedule" },
  { key: "sign", title: "Authorisation & Signature" },
];

// ── Long-form text (verbatim from the paper form) ───────────────────────────

export const FORM_INTRO_TEXT =
  "This document is the means by which a client provides Centrefit Group with the specific instructions detailing the response required to the various alarm signals and communications that the associated electronic security system is capable of sending. Please read this document carefully and select the option that best meets your security needs. If you do not know which option to choose, or would like help completing the form, then please call our IT Support Staff during business hours for assistance. Also note that all additional costs associated with the actioning of these alarms, such as the dispatch of a patrol officer, remain the sole responsibility of the client. If the details on this form change at any time, you must immediately notify Centrefit Group in writing.";

export const REISSUE_NOTE =
  "This form is pre-filled with your current instructions — only change the details that need updating, then sign to confirm.";

export const TIME_SCHEDULE_NOTE =
  "Note! All after hours openings are challenged after 15 minutes of disarming the alarm.";

export const ANNUAL_SERVICING_TEXT =
  "To comply with the Australian standards (AS/NZ2201.1.2007) a security alarm system that has a minor risk of attack is required to be maintained annually. It is the client's responsibility to organise annual servicing of their system and failure to have this annual maintenance undertaken may influence any future insurance claims. Clients may be contacted on the anniversary of the commencement of their security monitoring to schedule this maintenance work, or you can schedule this maintenance in advance by joining our Preventative Maintenance & Remote Support Programme (PMRSP) and receive remote support and discounted field service rates for both parts & labour. Contact our service department for a quote.";

export const LIABILITY_CLAUSES: string[] = [
  "Centrefit Group and Back2Base Monitoring (Monitoring Control Room) will not be held liable to any person, organisation or third party in respect to any damage or loss arising either directly or indirectly as a result of an alarm signal not being received to screen in the Monitoring Control Room because of a communication pathway failure, whether the failure is caused due to equipment malfunction, power loss, or malicious interventions by others. Such pathways can be but not necessarily provided by other service providers and may include but not exclusively limited to Power Failure, PSTN, NBN, Mobile and IP pathways. Where signals are successfully received to screen within the Monitoring Control Room, the Monitoring Control Room will action these alarms ONLY to the extent of the client's instructions and any/all costs associated because of these instructions will remain the sole responsibility of the client.",
  "Centrefit Group and Back2Base Monitoring (Monitoring Control Room) will not be held liable to any person, organisation or third party in respect to any loss of live or stored CCTV footage as a result of an image transfer failure, whether the failure is caused due to equipment malfunction, power loss, or malicious interventions by others. Such image transfer failures can be but not necessarily provided by other service providers and may include but not exclusively limited to Power Failure, Internet Dropouts, HDD Failure, NBN, Mobile and IP outages. Where signals are successfully received to screen within the Monitoring Control Room, the Control Room will action these alarms ONLY to the extent of the client's instructions and any/all costs associated as a result of these instructions will remain the sole responsibility of the client.",
  "Centrefit Group installs and Back2Base Monitoring monitors CCTV cameras for the client; such cameras are only accessed upon receipt of an alarm signal to screen within the Monitoring Control Room. It should be acknowledged that camera viewing after an event arriving to the screen in the Monitoring Control Room may not reveal or confirm any source of the alarm. As such the Monitoring Control Room will not be held liable to any person, organisation or third party in respect of any loss or damage arising either directly or indirectly as a result of viewing cameras after an alarm signal arrives to screen within the Monitoring Control Room. The Monitoring Control Room will action all alarms after viewing the cameras as per the client's instructions ONLY and any/all costs associated as a result of these instructions remain the sole responsibility of the client.",
  "Centrefit Group installs and maintains Security Alarm Systems and CCTV Digital Surveillance systems on behalf of our clients. All activities undertaken by the Monitoring Control Room in relation to Alarm Signals event and CCTV monitoring and the actions associated with such events in line with our clients' instructions shall be the responsibility of Back2Base Monitoring, ABN 23 515 589 179 located at 43 Flinders Parade, North Lakes QLD 4509.",
];

export const AUTHORISATION_TEXT =
  "The above information to the best of my knowledge is true and correct. I/We accept all fees and charges as issued in accordance with the options that I/We have selected and the exclusions of liability as described within this document.";

// ── Fee summary calculation (shared by form UI + PDF) ───────────────────────

export interface FeeLine {
  label: string;
  fee: MonitoringFee;
}

export interface FeeTotals {
  lines: FeeLine[];
  monthlyExGst: number;
  monthlyIncGst: number;
  yearlyExGst: number;
  yearlyIncGst: number;
}

export function calcFeeTotals(
  selections: MonitoringSelections,
  ifobUsers: IfobUserRow[],
  fees: MonitoringPrefill["fees"],
): FeeTotals {
  const lines: FeeLine[] = [];
  if (fees.monitoring) lines.push({ label: "Security Monitoring", fee: fees.monitoring });
  if ((selections.vav === "C1" || selections.vav === "C2") && fees.vav) {
    lines.push({ label: "Video Alarm Verification subscription", fee: fees.vav });
  }
  if (selections.sim_supply === "centrefit" && fees.sim) {
    lines.push({ label: "Duress Intercom SIM card (Centrefit supplied)", fee: fees.sim });
  }
  if (ifobUsers.some((u) => u.app_access && u.name.trim().length > 0) && fees.app) {
    lines.push({ label: "MyAlarm mobile app subscription", fee: fees.app });
  }
  const sum = (freq: "monthly" | "yearly", pick: (f: MonitoringFee) => number) =>
    Math.round(
      lines.filter((l) => l.fee.frequency === freq).reduce((acc, l) => acc + pick(l.fee), 0) * 100,
    ) / 100;
  return {
    lines,
    monthlyExGst: sum("monthly", (f) => f.priceExGst),
    monthlyIncGst: sum("monthly", (f) => f.priceIncGst),
    yearlyExGst: sum("yearly", (f) => f.priceExGst),
    yearlyIncGst: sum("yearly", (f) => f.priceIncGst),
  };
}

export function fmtAud(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Empty-state builders ────────────────────────────────────────────────────

export function emptyDayHours(): DayHours {
  return { open: "", close: "", cleaner: "", h24: false };
}

export function buildEmptyOpeningHours(): OpeningHours {
  const out: OpeningHours = {};
  for (const d of WEEK_DAYS) out[d] = emptyDayHours();
  return out;
}

export function padCallList(rows: CallListRow[] | null | undefined): CallListRow[] {
  const out = (rows ?? []).slice(0, 8).map((r) => ({ name: r.name ?? "", phone: r.phone ?? "" }));
  while (out.length < 8) out.push({ name: "", phone: "" });
  return out;
}

export function padIfobUsers(rows: IfobUserRow[] | null | undefined): IfobUserRow[] {
  // 8 rows, not 12 — Mitchell 2026-07-28 (suggestion queue).
  const out = (rows ?? [])
    .slice(0, 8)
    .map((r) => ({ name: r.name ?? "", pin: r.pin ?? "", app_access: Boolean(r.app_access) }));
  while (out.length < 8) out.push({ name: "", pin: "", app_access: false });
  return out;
}
