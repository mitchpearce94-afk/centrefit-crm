/**
 * Handover documentation — shared spec (Phase D, docs/documentation-CONTEXT.md).
 *
 * The pack is assembled per site from the datasheet library, driven by the
 * site's KEY INFORMATION assets only — if a key product isn't in the site's
 * key info it does NOT appear (Mitchell's rule). The alarm system is ONE
 * entry (Solution 6000 in general) — individual panel components are never
 * itemised. Procedure blocks come from the versioned library below.
 */

export const HANDOVER_TITLE = "Handover Manuals";

/** Asset-type slugs that are panel internals — never their own entry. */
export const ALARM_COMPONENT_SLUGS = [
  "alarm_main_board",
  "zone_expansion",
  "relay_expansion_4",
  "rf_receiver",
  "myalarm_ip",
];

/** Slugs that collapse into the single Solution 6000 alarm entry. */
export const ALARM_PANEL_SLUGS = ["alarm_panel", ...ALARM_COMPONENT_SLUGS];

/** Asset-type slugs that flag the site as having duress equipment. */
export const DURESS_SLUGS = ["duress_pendant", "duress_button", "duress_intercom", "sim_card"];

/**
 * TOC blurb per datasheet model (wording from the Core Plus Benowa template
 * where it exists; generic otherwise). Keyed by datasheets.model.
 */
export const PRODUCT_BLURBS: Record<string, string> = {
  "EPS-HDMI1001M4":
    "Contains all the information on the modulator that takes the HDMI input and converts it to RF output for TVs.",
  DS936: "Datasheet for the PIR motion detectors around the facility.",
  "Solution 6000":
    "Datasheet for the Solution 6000 alarm system protecting the facility. Doesn't include information on automation — contact Centrefit for information on automation.",
  "DH-IPC-HDW3666EMP": "Datasheet for the IP cameras installed in the facility.",
  "DHI-NVR4216/4232-16P-4KS2": "Datasheet for the network video recorder installed in the facility.",
  "GSM Duress Intercom":
    "Datasheet for the GSM duress intercom on the wall for members to use in emergency situations.",
  PRM240: "Datasheet for the audio amplifier in the server cabinet.",
  "NCSP Series": "Datasheet for the 100V ceiling-mounted speakers around the facility.",
  "BC Series": "Datasheet for the 100V wall-mounted speakers around the facility.",
  "KAT Series": "Datasheet for the Kingray active tap in the server cabinet.",
};

// ── Procedure library (versioned) ───────────────────────────────────────────

export interface ProcedureStep {
  title: string;
  body: string;
}

export interface Procedure {
  key: string;
  title: string;
  version: string;
  intro: string;
  steps: ProcedureStep[];
}

/** Included only when the site has duress assets. Content = V2.1 verbatim. */
export const DURESS_TESTING_PROCEDURE: Procedure = {
  key: "duress_testing",
  title: "Monthly Duress Testing Procedure",
  version: "V2.1",
  intro:
    "Duress systems are an emergency mechanism for visitors and staff to utilise in the unlikely event of an emergency. Duress systems, when activated, will alert our security control room to ensure that there is an emergency in progress. It is vitally important that your duress system operates normally and is operational when it's required to be used. To ensure that the system is functioning correctly, the system needs to be periodically tested each month.",
  steps: [
    {
      title: "Step 1 — Putting your system into Test Mode",
      body: "Because your duress system relies on an emergency broadcast protocol, the first step is to inform our security control room that the system is about to be tested. If they are not informed, they will treat your test as a live emergency event. Call 07 3865 6178 and inform the operator of your NAME and FACILITY and inform them that you are testing your duress system and request to have your facility placed in TEST MODE for 30 minutes.",
    },
    {
      title: "Step 2 — Duress Intercom",
      body: "Mounted on your wall is your duress intercom. Press and hold the single button until the intercom announces, \"Please wait, your call will be answered shortly\". The intercom will dial the programmed number, and an operator shall answer with \"Security, what is your emergency\". At this point they will know your call is a test situation. Simply state your NAME and FACILITY and that you are testing your duress intercom. The operator will acknowledge that they can hear you loud and clear. The operator will terminate the call, and the intercom will announce \"End of Call\". Nothing more you need to do — this procedure is now complete.",
    },
    {
      title: "Step 3 — Duress Single Button Pendants",
      body: "Overhanging the duress intercom will be a quantity of single-button pendants. Press and hold the red button until you see a red light appear at the top of the pendant. Repeat this procedure for each of the pendants. Nothing more you need to do — this procedure is now complete.",
    },
    {
      title: "Step 4 — Duress Button — Disabled Bathroom",
      body: "In the disabled bathroom you will find a duress button located next to the toilet. This is used in the event of an emergency. Push this button in and then twist back out to reset the button. Nothing more you need to do — this procedure is now complete.",
    },
    {
      title: "Step 5 — Resetting the iFob App Duress Zone",
      body: "When any of the duress buttons are pressed, the area called \"Duress - Do Not Arm\" in your security system is triggered. Open your iFob app on your mobile device. If you do not have this app, contact support@centrefit.com.au and we will help you set this up. When this area is in alarm, you will see a red flashing speaker, and you will also hear beeping coming from the keypad on your wall. To turn off both the red speaker in your app and the keypad audio, this area needs to be reset: Arm then Disarm the area in the app. Nothing more you need to do — this procedure is now complete.",
    },
    {
      title: "Step 6 — Getting the results of your tests",
      body: "Call the control room operator again on 07 3865 6178, tell them your NAME and FACILITY and inform them you have just completed your monthly duress testing. At this point, the operator will give you the results of both the intercom and button testing.",
    },
  ],
};

/**
 * Included when the site has a CCTV recorder. DRAFT v1.0 authored for the
 * Dahua NVR line we install — the source template linked out to a document
 * we don't hold. Flagged for Mitchell's review before first customer send.
 */
export const CCTV_PLAYBACK_PROCEDURE: Procedure = {
  key: "cctv_playback",
  title: "CCTV Recorder Playback Guide",
  version: "V1.0",
  intro:
    "Your CCTV system records continuously to the network video recorder (NVR) in the comms cabinet. Footage can be reviewed on the monitor connected to the recorder, or remotely via the mobile app where configured. Typical retention is around 30 days depending on camera count and settings.",
  steps: [
    {
      title: "Step 1 — Log in",
      body: "On the monitor connected to the recorder, right-click to open the menu and select Playback. Enter the credentials provided at handover. If you don't have your login details, contact support@centrefit.com.au.",
    },
    {
      title: "Step 2 — Choose cameras and a date",
      body: "Tick the cameras you want to review in the channel list, then pick the date on the calendar. Recorded periods show as a coloured band on the timeline at the bottom of the screen.",
    },
    {
      title: "Step 3 — Review the footage",
      body: "Click anywhere on the timeline to jump to that time. Use the playback controls to pause, fast-forward or step frame-by-frame, and drag the timeline scale to zoom in on a shorter window for fine scrubbing.",
    },
    {
      title: "Step 4 — Export a clip",
      body: "To save footage, use the clip/scissors tool to mark a start and end point on the timeline, insert a USB drive into the recorder, and choose Backup/Export. Export in MP4 where offered so the clip plays on any computer.",
    },
    {
      title: "Need footage for police or insurance?",
      body: "If an incident has occurred and you need assistance retrieving or preserving footage, contact Centrefit on (07) 3188 5115 as soon as possible so the footage is secured before it is overwritten.",
    },
  ],
};

// ── Compliance statement ────────────────────────────────────────────────────
// Canonical licence constants live in the monitoring-form spec (Mitchell
// confirmed 2026-07-05: the security paperwork's set wins; the old handover
// template's 64951/C12897 is stale and must never be used).

export function complianceStatement(licence: string, asial: string): string[] {
  return [
    "Centrefit Group Pty Ltd has undertaken the installation of the equipment at the above-mentioned facility.",
    `Centrefit Group Pty Ltd is the holder of Security Licence No: ${licence} and holds Corporate Membership of the Australian Security Industry Association Ltd (ASIAL), Membership No: ${asial}.`,
    "All equipment has been installed in accordance with the Security Providers Act 1993 (Schedule 1A of the Security Providers Regulations 2008, Section 11).",
  ];
}

export const ACCEPTANCE_STATEMENT =
  "I acknowledge receipt of this handover documentation and accept the installation of the equipment described within as complete. I understand that ongoing servicing, monitoring instructions and support are available from Centrefit Group as described in this pack.";
