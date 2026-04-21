// ============================================================================
// Centrefit Quote Engine — Scope of Works Generator
// Generates structured scope document from device counts + site info.
// Each clause has a stable ID so per-quote overrides can be applied on top.
// ============================================================================

import type { DeviceCounts, SiteInfo } from './constants';

export interface ScopeItem {
  id: string;             // stable within its section, e.g. 'tv_antenna_cables'
  text: string;           // final text (auto, overridden, or custom)
  included: boolean;      // whether this clause should render
  isCustom: boolean;      // user-added clause
  autoText?: string;      // original auto-generated text (for revert); absent on custom clauses
  autoIncluded?: boolean; // whether this clause would be included purely from triggers (pre-override); absent on custom
}

export interface ScopeSection {
  id: 'rough_in' | 'fit_off';
  heading: string;
  items: ScopeItem[];
}

export interface ScopeNote extends ScopeItem {}

export interface ScopeDocument {
  sections: ScopeSection[];
  notes: ScopeNote[];
  standards: string[];
}

export type ScopeOverrideMap = Record<
  string,
  { included?: boolean; text?: string } | undefined
>;

export interface ScopeOverrides {
  rough_in?: ScopeOverrideMap;
  fit_off?: ScopeOverrideMap;
  notes?: ScopeOverrideMap;
  custom?: {
    rough_in?: Array<{ id: string; text: string }>;
    fit_off?: Array<{ id: string; text: string }>;
    notes?: Array<{ id: string; text: string }>;
  };
}

// Helper: sum device codes
function sum(dc: DeviceCounts, ...codes: string[]): number {
  return codes.reduce((total, code) => total + (dc[code] ?? 0), 0);
}

// Helper: build an auto clause, applying override if present
function clause(
  id: string,
  autoText: string,
  autoIncluded: boolean,
  overrides?: ScopeOverrideMap,
): ScopeItem {
  const override = overrides?.[id];
  return {
    id,
    autoText,
    autoIncluded,
    text: override?.text ?? autoText,
    included: override?.included ?? autoIncluded,
    isCustom: false,
  };
}

export function generateScopeOfWorks(
  deviceCounts: DeviceCounts,
  siteInfo: SiteInfo,
  overrides?: ScopeOverrides,
): ScopeDocument {
  // ── DERIVED COUNTS ──
  const totalCameras = sum(deviceCounts, 'camera_black', 'camera_white');
  const roofSpeakers = sum(deviceCounts, 'speaker_roof_black', 'speaker_roof_white');
  const wallSpeakers = sum(deviceCounts, 'speaker_wall_black', 'speaker_wall_white');
  const totalSpeakers = roofSpeakers + wallSpeakers;
  const speakerMountDesc = roofSpeakers > 0 && wallSpeakers > 0
    ? 'both wall and ceiling mounted'
    : roofSpeakers > 0 ? 'ceiling mounted' : 'wall mounted';
  const totalSensors = sum(deviceCounts, 'pir_360_roof', 'pir_wall', 'reed_switch');
  const totalWAPs = deviceCounts.wap ?? 0;
  const totalDataPoints = deviceCounts.data_point ?? 0;
  const totalTailgate = deviceCounts.tailgate_system ?? 0;
  const totalDuressButtons = (deviceCounts.duress_button ?? 0) + (deviceCounts.duress_pendant ?? 0);
  const totalDuressIntercoms = deviceCounts.duress_intercom ?? 0;
  const totalDoorLocks = deviceCounts.door_lock ?? 0;
  const totalAlarmPanels = deviceCounts.alarm_panel ?? 0;
  const totalRFReceivers = deviceCounts.rf_receiver ?? 0;
  const tvCount = siteInfo.tv_count ?? 0;
  const ceilingTVCount = siteInfo.ceiling_tv_count ?? 0;
  const totalTVs = tvCount + ceilingTVCount;
  const wallMounts = siteInfo.wall_tv_mount_count ?? 0;
  const ceilingMounts = siteInfo.ceiling_tv_mount_count ?? 0;
  const totalMounts = wallMounts + ceilingMounts;
  const cardioCount = siteInfo.cardio_count ?? 0;

  // ── SYSTEM PRESENCE ──
  const hasAudio = totalSpeakers > 0;
  const hasSecurity = totalAlarmPanels > 0 || totalSensors > 0;
  const hasAccessControl = totalDoorLocks > 0;
  const hasCCTV = totalCameras > 0;
  const hasWAP = totalWAPs > 0;
  const hasTailgate = totalTailgate > 0;
  const hasAV = totalTVs > 0 || cardioCount > 0;
  const hasCabinet = sum(deviceCounts, 'cabinet_9ru', 'cabinet_27ru', 'cabinet_32ru', 'cabinet_42ru') > 0;
  const hasDataRuns = cardioCount > 0 || totalWAPs > 0 || totalDataPoints > 0;
  const hasFloorBoxes = cardioCount > 0; // floor boxes are for cardio equipment

  // Amplifier count: 1 per zone; 2 if there's a separate studio zone
  const amplifierCount = siteInfo.separate_studio_zone ? 2 : (hasAudio ? 1 : 0);
  const modulatorCount = totalTVs > 0 ? Math.ceil(totalTVs / 4) : 0;

  // ── ROUGH IN ──
  const roughInOv = overrides?.rough_in;
  const roughIn: ScopeItem[] = [
    clause('audio_cables',
      'Centrefit shall supply and install all audio cables for amplifiers and speakers. All cables and "C" plates are included.',
      hasAudio, roughInOv),
    clause('security_cables',
      'Centrefit shall supply and install all cabling for the security alarm system and associated devices.',
      hasSecurity, roughInOv),
    clause('access_cables',
      'Centrefit shall supply and install all cabling for the access control system(s) and associated devices in the facility.',
      hasAccessControl, roughInOv),
    clause('cctv_cables',
      'Centrefit shall supply and install all cabling for CCTV systems and cameras in the facility.',
      hasCCTV, roughInOv),
    clause('wap_cables',
      'Centrefit shall supply and install all cabling for WiFi Access Points in the facility.',
      hasWAP, roughInOv),
    clause('tailgate_cables',
      'Centrefit shall supply and install all cabling for FelixGate Tailgating System in the facility.',
      hasTailgate, roughInOv),
    clause('electrician_floor_boxes',
      'Clients Electrician shall supply and install floor ducting and floor boxes. See specification on technical drawings supplied by CentreFit.',
      hasFloorBoxes, roughInOv),
    clause('electrician_data_cabling',
      'Clients Electrician shall supply and install all data cabling for Cardio Equipment, Offices, Reception and Nightlife back to the server cabinet. See specification on technical drawings supplied by CentreFit.',
      hasDataRuns, roughInOv),
    clause('electrician_av_cabling',
      'Clients Electrician shall supply and install all AV cabling to the Cardio Equipment and all Wall Mounted TVs back to the server cabinet. See specification on technical drawings supplied by CentreFit.',
      hasAV, roughInOv),
    clause('electrician_tv_antenna_cables',
      'Clients Electrician shall supply and install all cabling for Digital TV Antenna signals to the server cabinet for distribution. See specification on technical drawings supplied by CentreFit.',
      totalTVs > 0, roughInOv),
    clause('electrical_exclusion',
      'ANY AND ALL ELECTRICAL WORKS IS NOT INCLUDED',
      true, roughInOv),
  ];

  // Append custom rough-in clauses
  for (const c of overrides?.custom?.rough_in ?? []) {
    roughIn.push({ id: c.id, text: c.text, included: true, isCustom: true });
  }

  // ── FIT OFF ──
  const fitOffOv = overrides?.fit_off;

  const avDistributionText = totalTVs > 0
    ? `Centrefit shall supply, install and commission all AV amplifiers, splitters and (${modulatorCount}) modulator${modulatorCount !== 1 ? 's' : ''} into the server cabinet for AV distribution to all TV and cardio machines. All terminations are included.`
    : 'Centrefit shall supply, install and commission AV amplifiers and splitters into the server cabinet for AV distribution to cardio machines. All terminations are included.';

  const tvInstallText = totalMounts > 0
    ? `Centrefit shall install and commission (${totalTVs}) CUSTOMER SUPPLIED TV's with (${totalMounts}) CENTREFIT SUPPLIED TV mounts to walls of the facility as per the plan.`
    : `Centrefit shall install and commission (${totalTVs}) CUSTOMER SUPPLIED TV's with mounts to walls of the facility as per the plan.`;

  const alarmParts: string[] = [`(${totalSensors}) Sensors for both Intrusion and Member detection`];
  if (hasAccessControl) alarmParts.push('Access control for the door/s');
  if (totalRFReceivers > 0) alarmParts.push(`(${totalRFReceivers * 3}) wireless pendants`);
  if (totalDuressButtons > 0) {
    const locations = totalDuressButtons === 1 ? 'the disabled toilet' : 'designated locations';
    alarmParts.push(`(${totalDuressButtons}) duress button${totalDuressButtons > 1 ? 's' : ''} in ${locations}`);
  }
  if (totalDuressIntercoms > 0) alarmParts.push('Duress intercom');
  const alarmInstallText = `Centrefit shall supply, install and commission 24/7 monitored alarm system with ${alarmParts.join(', ')}.`;

  const wapTail = totalWAPs > 0
    ? ` (${totalWAPs}) Access Point${totalWAPs > 1 ? 's' : ''}, supplied, installed and configured.`
    : '';
  const cabinetInstallText = `Centrefit shall supply, install and commission all server cabinets in the comms room and other areas specified on the plan, Gigabit managed switches, UPS and cable management with associated fly leads.${wapTail} All terminations at rack end are included.`;

  const audioInstallText = `Centrefit shall supply, install and commission the (${amplifierCount}) amplifier${amplifierCount > 1 ? 's' : ''} and (${totalSpeakers}) speakers ${speakerMountDesc} in the facility. All terminations, faceplates and speaker mounts are included.`;

  const fitOff: ScopeItem[] = [
    clause('cabinet_termination',
      'Centrefit shall terminate all AV and Data cabling at the Server Cabinet end. AV and Data terminations are included.',
      hasCabinet || hasAV, fitOffOv),
    clause('audio_install',
      audioInstallText,
      hasAudio, fitOffOv),
    clause('data_termination',
      'Centrefit shall terminate and commission all Data cabling into the server cabinet for Ethernet / Internet to cardio machines, Nightlife kiosk and reception desk. All terminations are included.',
      hasDataRuns, fitOffOv),
    clause('av_distribution',
      avDistributionText,
      hasAV, fitOffOv),
    clause('tv_install',
      tvInstallText,
      totalTVs > 0, fitOffOv),
    clause('cctv_install',
      `Centrefit shall supply, install and commission CCTV NVR and all (${totalCameras}) cameras in the facility to obtain full 24/7 coverage. All terminations and wall mount brackets are included.`,
      hasCCTV, fitOffOv),
    clause('alarm_install',
      alarmInstallText,
      hasSecurity, fitOffOv),
    clause('cabinet_install',
      cabinetInstallText,
      hasCabinet, fitOffOv),
    clause('tailgate_install',
      `Centrefit shall supply, install and commission (${totalTailgate}) FelixGate Tailgating System${totalTailgate > 1 ? 's' : ''}. All terminations are included.`,
      hasTailgate, fitOffOv),
    clause('security_automation',
      'Centrefit shall supply and commission all automation in relation to the Security system for lights and music control.',
      hasSecurity, fitOffOv),
    clause('electrician_tv_antenna_install',
      'Clients Electrician shall supply and install the Digital TV Antenna for TV distribution.',
      totalTVs > 0, fitOffOv),
    clause('electrician_av_data_terminations',
      "Clients Electrician shall terminate all AV and Data points in relation to floor boxes, offices and reception desk and where otherwise specified on the plans. All cabling run to the comms rack shall be in accordance with technical drawings supplied by CentreFit.",
      hasFloorBoxes || totalDataPoints > 0, fitOffOv),
    clause('electrician_switchboard_split',
      'Clients Electrician shall configure the electrical switch board to split lighting circuits into 4 circuits and run a twin cable to the Security System. See specification on technical drawings supplied by CentreFit.',
      hasSecurity, fitOffOv),
    clause('training',
      'Full training for all facility staff to manage CCTV and Security system via mobile device is included.',
      hasCCTV || hasSecurity, fitOffOv),
    clause('electrical_exclusion',
      'ANY AND ALL ELECTRICAL WORKS IS NOT INCLUDED',
      true, fitOffOv),
  ];

  for (const c of overrides?.custom?.fit_off ?? []) {
    fitOff.push({ id: c.id, text: c.text, included: true, isCustom: true });
  }

  // ── PLEASE NOTE ──
  const notesOv = overrides?.notes;
  const notes: ScopeNote[] = [
    clause('duress_intercom_sim',
      '4G Postpaid Phone SIM Card is required for each Duress Intercom. This can be supplied by the client or Centrefit can supply at $22.50 ex GST / month ongoing charge (Direct Debit).',
      totalDuressIntercoms > 0, notesOv),
    clause('security_monitoring',
      'Monthly security monitoring fees of $55.00 ex GST applies to this service (Direct Debit).',
      hasSecurity, notesOv),
    clause('app_subscription',
      'Annual Mobile app subscription of $133.50 ex GST applies to this service (Direct Debit).',
      hasSecurity, notesOv),
    clause('tailgate_billing',
      'Felix Gate will have an ongoing cost. This will be billed directly from Gibson Global Limited to the end user.',
      hasTailgate, notesOv),
    clause('door_strikes',
      'The fitting of any and all Electronic Door Strikes is not included in this quotation and will be invoiced directly to the Client by the Locksmith.',
      hasAccessControl, notesOv),
  ];

  for (const c of overrides?.custom?.notes ?? []) {
    notes.push({ id: c.id, text: c.text, included: true, isCustom: true });
  }

  // ── STANDARDS ──
  const standards = [
    "AS/NZS 2201.1-2007 Intruder alarm systems, Part 1: Client's premises - Design, installation, commissioning and maintenance",
    'AS4806 Closed circuit televisions (CCTV) Part 1: Management and operation',
    'AS/NZS 62676.1.2:2020 - Video surveillance systems for use in security applications systems',
    'AS/NZS IEC 60839.11.1:2019 - Alarm and electronic security systems Electronic access control systems - System and components requirements',
    'AS/CA S009:2020 - Installation requirements for customer cabling (wiring rules)',
    'AS 11801.5:2019 - Data and Information technology - Generic cabling for customer premises',
  ];

  return {
    sections: [
      { id: 'rough_in', heading: 'ROUGH IN', items: roughIn },
      { id: 'fit_off', heading: 'FIT OFF', items: fitOff },
    ],
    notes,
    standards,
  };
}
