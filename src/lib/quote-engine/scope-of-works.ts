// ============================================================================
// Centrefit Quote Engine — Scope of Works Generator
// Generates structured scope document from device counts + site info.
// Template based on the Snap Fitness Pimpama IT Equipment Listing.
// ============================================================================

import type { DeviceCounts, SiteInfo } from './constants';
import { DEVICE_TYPES } from './constants';

export interface ScopeSection {
  heading: string;
  items: string[];
}

export interface ScopeDocument {
  sections: ScopeSection[];
  notes: string[];
  standards: string[];
}

// Helper: sum device codes
function sum(dc: DeviceCounts, ...codes: string[]): number {
  return codes.reduce((total, code) => total + (dc[code] ?? 0), 0);
}

export function generateScopeOfWorks(
  deviceCounts: DeviceCounts,
  siteInfo: SiteInfo,
): ScopeDocument {
  const totalCameras = sum(deviceCounts, 'camera_black', 'camera_white');
  const roofSpeakers = sum(deviceCounts, 'speaker_roof_black', 'speaker_roof_white');
  const wallSpeakers = sum(deviceCounts, 'speaker_wall_black', 'speaker_wall_white');
  const totalSpeakers = roofSpeakers + wallSpeakers;
  const speakerMountDesc = roofSpeakers > 0 && wallSpeakers > 0
    ? 'both wall and ceiling mounted'
    : roofSpeakers > 0 ? 'ceiling mounted' : 'wall mounted';
  const totalSensors = sum(deviceCounts, 'pir_360_roof', 'pir_wall', 'reed_switch');
  const totalWAPs = deviceCounts.wap ?? 0;
  const totalTailgate = deviceCounts.tailgate_system ?? 0;
  const totalDuressButtons = deviceCounts.duress_button ?? 0;
  const totalDuressIntercoms = deviceCounts.duress_intercom ?? 0;
  const totalDoorLocks = deviceCounts.door_lock ?? 0;
  const totalAlarmPanels = deviceCounts.alarm_panel ?? 0;
  const totalLightSirens = deviceCounts.light_siren ?? 0;
  const totalRFReceivers = deviceCounts.rf_receiver ?? 0;
  const tvCount = siteInfo.tv_count ?? 0;
  const ceilingTVCount = siteInfo.ceiling_tv_count ?? 0;
  const totalTVs = tvCount + ceilingTVCount;
  const wallMounts = siteInfo.wall_tv_mount_count ?? 0;
  const ceilingMounts = siteInfo.ceiling_tv_mount_count ?? 0;
  const totalMounts = wallMounts + ceilingMounts;
  const cardioCount = siteInfo.cardio_count ?? 0;

  // Detect which systems are present
  const hasAudio = totalSpeakers > 0;
  const hasSecurity = totalAlarmPanels > 0 || totalSensors > 0;
  const hasAccessControl = totalDoorLocks > 0;
  const hasCCTV = totalCameras > 0;
  const hasWAP = totalWAPs > 0;
  const hasTailgate = totalTailgate > 0;
  const hasAV = totalTVs > 0 || cardioCount > 0;
  const hasDuress = totalDuressButtons > 0 || totalDuressIntercoms > 0;
  const hasCabinet = sum(deviceCounts, 'cabinet_9ru', 'cabinet_27ru', 'cabinet_32ru', 'cabinet_42ru') > 0;

  // Count amplifiers (1 per zone — assume 1 unless separate studio)
  const amplifierCount = siteInfo.separate_studio_zone ? 2 : (hasAudio ? 1 : 0);

  // ── ROUGH IN ──
  const roughIn: string[] = [];

  if (hasAudio) {
    roughIn.push('Centrefit shall supply and install all audio cables for amplifiers and speakers. All cables and "C" plates are included.');
  }
  if (hasSecurity) {
    roughIn.push('Centrefit shall supply and install all cabling for the security alarm system and associated devices.');
  }
  if (hasAccessControl) {
    roughIn.push('Centrefit shall supply and install all cabling for the access control system(s) and associated devices in the facility.');
  }
  if (hasCCTV) {
    roughIn.push('Centrefit shall supply and install all cabling for CCTV systems and cameras in the facility.');
  }
  if (hasWAP) {
    roughIn.push('Centrefit shall supply and install all cabling for WiFi Access Points in the facility.');
  }
  if (hasTailgate) {
    roughIn.push('Centrefit shall supply and install all cabling for FelixGate Tailgating System in the facility.');
  }

  // Electrician scope (always included)
  roughIn.push(
    'Clients Electrician shall supply and install floor ducting and floor boxes. See specification on technical drawings supplied by CentreFit.',
    'Clients Electrician shall supply and install all data cabling for Cardio Equipment, Offices, Reception and Nightlife back to the server cabinet. See specification on technical drawings supplied by CentreFit.',
    'Clients Electrician shall supply and install all AV cabling to the Cardio Equipment and all Wall Mounted TVs back to the server cabinet. See specification on technical drawings supplied by CentreFit.',
    'Clients Electrician shall supply and install all cabling for Digital TV Antenna signals to the server cabinet for distribution. See specification on technical drawings supplied by CentreFit.',
    'ANY AND ALL ELECTRICAL WORKS IS NOT INCLUDED',
  );

  // ── FIT OFF ──
  const fitOff: string[] = [];

  // AV/Data termination at cabinet (always if we have a cabinet)
  if (hasCabinet || hasAV) {
    fitOff.push('Centrefit shall terminate all AV and Data cabling at the Server Cabinet end. AV and Data terminations are included.');
  }

  if (hasAudio) {
    fitOff.push(`Centrefit shall supply, install and commission the (${amplifierCount}) amplifier${amplifierCount > 1 ? 's' : ''} and (${totalSpeakers}) speakers ${speakerMountDesc} in the facility. All terminations, faceplates and speaker mounts are included.`);
  }

  // Data termination
  if (hasWAP || cardioCount > 0) {
    fitOff.push('Centrefit shall terminate and commission all Data cabling into the server cabinet for Ethernet / Internet to cardio machines, Nightlife kiosk and reception desk. All terminations are included.');
  }

  // AV distribution
  if (hasAV) {
    const modulatorCount = Math.ceil(totalTVs / 4) || 1;
    fitOff.push(`Centrefit shall supply, install and commission all AV amplifiers, splitters and (${modulatorCount}) modulators into the server cabinet for AV distribution to all TV and cardio machines. All terminations are included.`);
  }

  // TVs
  if (totalTVs > 0) {
    if (totalMounts > 0) {
      fitOff.push(`Centrefit shall install and commission (${totalTVs}) CUSTOMER SUPPLIED TV's with (${totalMounts}) CENTREFIT SUPPLIED TV mounts to walls of the facility as per the plan.`);
    } else {
      fitOff.push(`Centrefit shall install and commission (${totalTVs}) CUSTOMER SUPPLIED TV's with mounts to walls of the facility as per the plan.`);
    }
  }

  // CCTV
  if (hasCCTV) {
    fitOff.push(`Centrefit shall supply, install and commission CCTV NVR and all (${totalCameras}) cameras in the facility to obtain full 24/7 coverage. All terminations and wall mount brackets are included.`);
  }

  // Security + Access Control
  if (hasSecurity) {
    const parts: string[] = [];
    parts.push(`(${totalSensors}) Sensors for both Intrusion and Member detection`);
    if (hasAccessControl) parts.push('Access control for the door/s');
    if (totalRFReceivers > 0) parts.push(`(${totalRFReceivers * 3}) wireless pendants`);
    if (totalDuressButtons > 0) {
      const locations = totalDuressButtons === 1 ? 'the disabled toilet' : 'designated locations';
      parts.push(`(${totalDuressButtons}) duress button${totalDuressButtons > 1 ? 's' : ''} in ${locations}`);
    }
    if (totalDuressIntercoms > 0) parts.push('Duress intercom');
    fitOff.push(`Centrefit shall supply, install and commission 24/7 monitored alarm system with ${parts.join(', ')}.`);
  }

  // Server cabinet + WAPs
  if (hasCabinet) {
    const wapText = totalWAPs > 0
      ? ` (${totalWAPs}) Access Point${totalWAPs > 1 ? 's' : ''}, supplied, installed and configured.`
      : '';
    fitOff.push(`Centrefit shall supply, install and commission all server cabinets in the comms room and other areas specified on the plan, Gigabit managed switches, UPS and cable management with associated fly leads.${wapText} All terminations at rack end are included.`);
  }

  // FelixGate
  if (hasTailgate) {
    fitOff.push(`Centrefit shall supply, install and commission (${totalTailgate}) FelixGate Tailgating System${totalTailgate > 1 ? 's' : ''}. All terminations are included.`);
  }

  // Automation
  if (hasSecurity) {
    fitOff.push('Centrefit shall supply and commission all automation in relation to the Security system for lights and music control.');
  }

  // Electrician fit-off items
  fitOff.push(
    'Clients Electrician shall supply and install the Digital TV Antenna for TV distribution.',
    "Clients Electrician shall terminate all AV and Data points in relation to floor boxes, offices and reception desk and where otherwise specified on the plans. All cabling run to the comms rack shall be in accordance with technical drawings supplied by CentreFit.",
    'Clients Electrician shall configure the electrical switch board to split lighting circuits into 4 circuits and run a twin cable to the Security System. See specification on technical drawings supplied by CentreFit.',
  );

  // Training (always)
  fitOff.push('Full training for all facility staff to manage CCTV and Security system via mobile device is included.');

  fitOff.push('ANY AND ALL ELECTRICAL WORKS IS NOT INCLUDED');

  // ── PLEASE NOTE ──
  const notes: string[] = [];

  if (totalDuressIntercoms > 0) {
    notes.push('4G Postpaid Phone SIM Card is required for each Duress Intercom. This can be supplied by the client or Centrefit can supply at $22.50 ex GST / month ongoing charge (Direct Debit).');
  }
  if (hasSecurity) {
    notes.push('Monthly security monitoring fees of $55.00 ex GST applies to this service (Direct Debit).');
    notes.push('Annual Mobile app subscription of $133.50 ex GST applies to this service (Direct Debit).');
  }
  if (hasTailgate) {
    notes.push('Felix Gate will have an ongoing cost. This will be billed directly from Gibson Global Limited to the end user.');
  }
  if (hasAccessControl) {
    notes.push('The fitting of any and all Electronic Door Strikes is not included in this quotation and will be invoiced directly to the Client by the Locksmith.');
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
      { heading: 'ROUGH IN', items: roughIn },
      { heading: 'FIT OFF', items: fitOff },
    ],
    notes,
    standards,
  };
}
