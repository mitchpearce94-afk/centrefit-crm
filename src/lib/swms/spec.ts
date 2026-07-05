/**
 * SWMS master template — shared spec (Phase C, docs/documentation-CONTEXT.md).
 *
 * ONE master install template: "Installation & Commissioning of Security,
 * Access Control and CCTV Infrastructure", content verbatim from the
 * Rev 2.0 document (Snap Fitness Brisbane CBD, approved 30/06/2026).
 * Task groups are toggleable per generation; risk ratings are residual
 * (with controls in place); LL × CL = risk score against the 5×5 matrix.
 */

export const SWMS_TITLE =
  "Installation & Commissioning of Security, Access Control and CCTV Infrastructure";
export const SWMS_TEMPLATE_VERSION = "Rev 2.0";

export const CF_COMPANY = {
  name: "Centrefit Group Pty Ltd",
  acn: "168 413 161",
  address: "Unit 1, 25 Paisley Drive, Lawnton QLD 4501",
  email: "admin@centrefit.com.au",
};

export interface SwmsHazard {
  hazard: string;
  controls: string[];
  responsible: string;
  ll: number;
  cl: number;
}

export interface SwmsTaskGroup {
  key: string;
  title: string;
  description: string;
  hazards: SwmsHazard[];
}

export const SWMS_TASK_GROUPS: SwmsTaskGroup[] = [
  {
    key: "site_setup",
    title: "SITE SETUP & ACCESS",
    description:
      "Establishing the work area within an operating club; staging equipment; protecting members, staff and the public.",
    hazards: [
      {
        hazard: "Members / public present in an operating (and potentially 24/7) club",
        controls: [
          "Establish exclusion zones using barriers, cones and signage around active work areas",
          "Schedule intrusive or overhead work outside peak / unstaffed hours where practicable",
          "Brief club staff before each shift; maintain clear egress at all times",
        ],
        responsible: "Installation Manager / Technician",
        ll: 2, cl: 2,
      },
      {
        hazard: "Slips, trips and falls on the same level (temporary cabling and leads during rough-in)",
        controls: [
          "Run cables to walls; cover or flag any temporary leads crossing walkways",
          "Keep RCD-protected power leads off the floor / out of thoroughfares",
          "Progressive housekeeping throughout the shift",
        ],
        responsible: "Technician",
        ll: 2, cl: 2,
      },
      {
        hazard: "Lone working / after-hours work",
        controls: [
          "Documented check-in / check-out procedure with a nominated contact",
          "Mobile phone carried at all times; no solo work at height",
          "Emergency arrangements communicated before commencing",
        ],
        responsible: "Installation Manager",
        ll: 2, cl: 2,
      },
    ],
  },
  {
    key: "rough_in",
    title: "ROUGH-IN",
    description: "Installing catenary wire; running security, access control and CCTV cabling.",
    hazards: [
      {
        hazard: "Falls from height — elevating work platform (scissor lift / EWP)",
        controls: [
          "EWP operated only by a competent, trained operator; pre-start inspection completed",
          "Harness and lanyard worn and clipped to the platform's designated anchor point",
          "Level ground, wheels chocked, exclusion zone below; spotter where required",
          "Fall risk managed wherever a fall could cause injury — not tied to a fixed height trigger",
        ],
        responsible: "Technician (EWP competent)",
        ll: 1, cl: 4,
      },
      {
        hazard: "Falls from height — ladder",
        controls: [
          "Ladder used only for short-duration, light work; industrial-rated, footed and secured",
          "Maintain three points of contact; no over-reaching; reposition rather than stretch",
          "A ladder is NOT used as a fall-arrest anchor point",
        ],
        responsible: "Technician",
        ll: 2, cl: 3,
      },
      {
        hazard: "Hazardous manual task — cable reels, catenary tensioning, sustained overhead work",
        controls: [
          "Mechanical aids first (cable stands / trolley) before manual handling",
          "Team lift for loads over 20 kg or awkward items; rotate overhead tasks",
          "Workers trained per Hazardous Manual Tasks Code of Practice 2021 and CF training plan",
        ],
        responsible: "Technician(s)",
        ll: 2, cl: 2,
      },
      {
        hazard: "Cuts / abrasions from cable ends and hand tools",
        controls: [
          "Gloves worn; cable ends de-burred / capped",
          "Cut away from the body with sharp, serviceable tools",
        ],
        responsible: "Technician",
        ll: 2, cl: 1,
      },
    ],
  },
  {
    key: "drilling",
    title: "DRILLING & PENETRATIONS",
    description: "Drilling walls / ceilings for device mounts, brackets and cable penetrations.",
    hazards: [
      {
        hazard: "Striking concealed services (electrical, data, water)",
        controls: [
          "Review building / services drawings before drilling",
          "Scan with a cable / stud / metal detector and confirm a clear path",
          "Isolate nearby circuits where there is any doubt",
        ],
        responsible: "Technician",
        ll: 2, cl: 4,
      },
      {
        hazard: "Respirable crystalline silica / dust (concrete, masonry, fibre-cement)",
        controls: [
          "On-tool M-class dust extraction or wet methods; avoid dry cutting",
          "P2 respirator worn; bystanders excluded from the dust zone",
          "Managed per Managing respirable crystalline silica dust exposure Code of Practice",
        ],
        responsible: "Technician",
        ll: 2, cl: 3,
      },
      {
        hazard: "Asbestos-containing materials (older building fabric)",
        controls: [
          "Confirm building age and review the asbestos register / management plan BEFORE any penetration",
          "If ACM is present or suspected — STOP; do not drill or cut; engage a licensed assessor / removalist",
          "Managed per How to Manage and Control Asbestos in the Workplace Code of Practice 2021",
        ],
        responsible: "Installation Manager",
        ll: 1, cl: 5,
      },
      {
        hazard: "Noise (drilling, hammer drilling)",
        controls: [
          "Hearing protection worn; limit duration of exposure",
          "Warn others in the immediate area",
        ],
        responsible: "Technician",
        ll: 2, cl: 2,
      },
    ],
  },
  {
    key: "fit_off",
    title: "FIT-OFF & TERMINATION",
    description:
      "Terminating all cabling; mounting cameras, readers and devices; installing the alarm panel and CCTV recorder into the server cabinet (cabinet supplied by others).",
    hazards: [
      {
        hazard: "Falls from height (mounting cameras / devices at ceiling height)",
        controls: [
          "Controls as per Rough-In — EWP with harness to anchor, or compliant ladder for light short work",
          "Dual ladders / platforms and a second person for awkward mounting positions",
        ],
        responsible: "Technician (EWP competent)",
        ll: 1, cl: 4,
      },
      {
        hazard: "Electrical — terminating recorder / panel, working in / near the server cabinet, power tools and leads",
        controls: [
          "Field cabling is ELV / SELV; any 240 V connection performed by a licensed electrician, or plug-in to an existing tested GPO only",
          "All leads and power tools tested-and-tagged and RCD-protected",
          "Isolate and verify de-energised before working on or near energised parts — no live work",
        ],
        responsible: "Licensed Electrician / Technician",
        ll: 1, cl: 5,
      },
      {
        hazard: "Crush injury (hands / feet) mounting devices and equipment",
        controls: [
          "Steel-cap boots and gloves worn",
          "Two-person lift-and-hold for heavy or awkward devices",
        ],
        responsible: "Technician",
        ll: 1, cl: 2,
      },
      {
        hazard: "Hazardous manual task — mounting larger components (recorder, panel, into cabinet)",
        controls: [
          "Mechanical aid / trolley used; two-person lift; lift path pre-planned and cleared",
        ],
        responsible: "Technician(s)",
        ll: 2, cl: 2,
      },
      {
        hazard: "Optical fibre handling (where applicable) — glass off-cuts / splinters",
        controls: [
          "Off-cuts collected in a dedicated bin / tray; no eating or drinking in the work area",
          "Eye protection worn; hands washed before leaving the area",
        ],
        responsible: "Technician",
        ll: 1, cl: 2,
      },
    ],
  },
  {
    key: "commissioning",
    title: "COMMISSIONING & TEST",
    description: "Powering up, configuring and testing installed security, access control and CCTV systems.",
    hazards: [
      {
        hazard: "Electrical / ELV testing",
        controls: [
          "Use rated, serviceable test equipment per manufacturer procedure",
          "Verify isolation before connecting / disconnecting",
        ],
        responsible: "Technician",
        ll: 1, cl: 2,
      },
      {
        hazard: "Working at height to adjust / aim devices",
        controls: ["Controls as per Rough-In (EWP or compliant ladder)"],
        responsible: "Technician",
        ll: 1, cl: 4,
      },
    ],
  },
  {
    key: "pack_up",
    title: "PACK-UP & WASTE REMOVAL",
    description: "Breaking down packaging; bagging plastics; removing waste off site.",
    hazards: [
      {
        hazard: "Hazardous manual task (cardboard / packaging, removal off site)",
        controls: [
          "Flat-pack and bundle; mechanical aid / trolley for bulk",
          "Team lift; clear and planned path to the waste point",
        ],
        responsible: "Technician(s)",
        ll: 2, cl: 2,
      },
      {
        hazard: "Trips from packaging and off-cuts",
        controls: ["Progressive clean-up; waste bagged; egress kept clear"],
        responsible: "Technician",
        ll: 2, cl: 1,
      },
    ],
  },
];

export const RISK_ASSESSMENT_PREAMBLE =
  "Hazards identified using the How to Manage Work Health and Safety Risks Code of Practice 2021 (Qld) as a guide. Controls are listed in line with the hierarchy of controls (eliminate, substitute, isolate, engineering, administrative, PPE). Risk ratings shown are residual (with controls in place).";

export const RISK_MATRIX_LL_LABELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
export const RISK_MATRIX_CL_LABELS = ["Insignificant", "Minor", "Moderate", "Major", "Catastrophic"];

export const RISK_RATINGS = [
  { range: "1 – 3", rating: "Low", action: "Manage by routine procedures." },
  { range: "4 – 9", rating: "Medium", action: "Specific controls / monitoring required." },
  { range: "10 – 15", rating: "High", action: "Senior review; controls before work proceeds." },
  { range: "16 – 25", rating: "Extreme", action: "Do not proceed; eliminate / redesign the task." },
];

export function riskRating(score: number): string {
  if (score <= 3) return "Low";
  if (score <= 9) return "Medium";
  if (score <= 15) return "High";
  return "Extreme";
}

export const SWMS_LEGISLATION = [
  "Work Health and Safety Act 2011 (Qld)",
  "Work Health and Safety Regulation 2011 (Qld)",
  "How to Manage Work Health and Safety Risks Code of Practice 2021 (Qld)",
  "Managing the Risk of Falls at Workplaces Code of Practice 2021 (Qld)",
  "Hazardous Manual Tasks Code of Practice 2021 (Qld)",
  "Managing Electrical Risks in the Workplace Code of Practice 2021 (Qld)",
  "How to Manage and Control Asbestos in the Workplace Code of Practice 2021 (Qld)",
  "Managing Respirable Crystalline Silica Dust Exposure Code of Practice (Qld)",
  "First Aid in the Workplace Code of Practice 2021 (Qld)",
];

export const SWMS_COMPETENCIES = [
  "ACMA cabling registration (Open) for all fixed-line telecommunications cabling.",
  "Security installer / equipment installer licence under the Security Providers Act (Qld) for access control and CCTV work.",
  "EWP / scissor-lift operation competency for all personnel operating elevating work platforms.",
  "Manual handling training per the Hazardous Manual Tasks Code of Practice 2021 and the CF training plan.",
  "Where 240 V connection is required, work is performed by a licensed electrician.",
  "All technicians are issued the required PPE prior to commencing work with Centrefit.",
];

export function swmsEmergencyArrangements(siteAddress: string, nearestHospital: string): string[] {
  return [
    `Emergency services: dial 000. Site address: ${siteAddress}.`,
    "A stocked first aid kit is kept on site; a trained first aider is nominated for each shift.",
    `Nearest hospital (emergency department): ${nearestHospital}.`,
    "Any worker may cease unsafe work; report immediately to the Installation Manager.",
    "Notifiable incidents are reported to Workplace Health and Safety Queensland on 1300 362 128 and the site is preserved as required.",
  ];
}

export const SWMS_MONITORING_REVIEW =
  "This SWMS is reviewed if the work method changes, if an incident or near-miss occurs, if control is found to be inadequate, or at the request of a worker. Controls are monitored throughout the works by the responsible parties listed above.";

export const SWMS_APPROVAL_STATEMENT =
  "I have reviewed this SWMS and approve the proposed work activity to commence once consultation with relevant people has been undertaken.";

export const SWMS_SIGNON_STATEMENT =
  "The details and requirements of this SWMS have been communicated to me and I understand the hazards and control measures to be implemented as part of this activity. (Each person signs and dates on the day they are briefed.)";

export const SWMS_EQUIPMENT = [
  "PPE — hi-vis shirt / vest, hearing protection, safety glasses",
  "Safety boots (steel cap)",
  "P2 respirator (for drilling / dust tasks)",
  "Scissor lift / EWP (with harness & lanyard)",
  "Ladders (industrial-rated)",
  "Tool bags / hand tools",
  "Cordless drill with on-tool dust extraction",
  "Cable / stud / metal detector",
  "Test equipment — cable certifier, tracer, multimeter, OTDR / optical power meter",
];

// ── Nearest emergency department lookup ─────────────────────────────────────
//
// Offline lookup: major Australian public hospitals with 24/7 emergency
// departments. customer_sites carries lat/lng, so the generator picks the
// nearest by great-circle distance; the modal lets staff override. SEQ-dense
// because that's where most Centrefit sites are.

export interface Hospital {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export const HOSPITALS: Hospital[] = [
  // Brisbane metro
  { name: "Royal Brisbane and Women's Hospital", address: "Butterfield St, Herston QLD 4029", lat: -27.4475, lng: 153.0273 },
  { name: "Princess Alexandra Hospital", address: "199 Ipswich Rd, Woolloongabba QLD 4102", lat: -27.4975, lng: 153.0304 },
  { name: "Mater Hospital Brisbane", address: "Raymond Tce, South Brisbane QLD 4101", lat: -27.4859, lng: 153.0271 },
  { name: "The Prince Charles Hospital", address: "627 Rode Rd, Chermside QLD 4032", lat: -27.3841, lng: 153.0342 },
  { name: "QEII Jubilee Hospital", address: "Kessels Rd, Coopers Plains QLD 4108", lat: -27.5501, lng: 153.0398 },
  { name: "Redcliffe Hospital", address: "Anzac Ave, Redcliffe QLD 4020", lat: -27.2199, lng: 153.0946 },
  { name: "Caboolture Hospital", address: "120 McKean St, Caboolture QLD 4510", lat: -27.0851, lng: 152.9558 },
  { name: "Logan Hospital", address: "Cnr Armstrong & Loganlea Rds, Meadowbrook QLD 4131", lat: -27.6699, lng: 153.1400 },
  { name: "Redland Hospital", address: "Weippin St, Cleveland QLD 4163", lat: -27.5300, lng: 153.2585 },
  { name: "Ipswich Hospital", address: "Chelmsford Ave, Ipswich QLD 4305", lat: -27.6119, lng: 152.7583 },
  // QLD regional
  { name: "Gold Coast University Hospital", address: "1 Hospital Blvd, Southport QLD 4215", lat: -27.9564, lng: 153.3820 },
  { name: "Robina Hospital", address: "2 Bayberry Ln, Robina QLD 4226", lat: -28.0731, lng: 153.3855 },
  { name: "Sunshine Coast University Hospital", address: "6 Doherty St, Birtinya QLD 4575", lat: -26.7454, lng: 153.1236 },
  { name: "Nambour General Hospital", address: "Hospital Rd, Nambour QLD 4560", lat: -26.6273, lng: 152.9558 },
  { name: "Toowoomba Hospital", address: "Pechey St, Toowoomba QLD 4350", lat: -27.5480, lng: 151.9370 },
  { name: "Bundaberg Hospital", address: "271 Bourbong St, Bundaberg QLD 4670", lat: -24.8620, lng: 152.3403 },
  { name: "Hervey Bay Hospital", address: "Cnr Nissen St & Urraween Rd, Pialba QLD 4655", lat: -25.2949, lng: 152.8353 },
  { name: "Rockhampton Hospital", address: "Canning St, Rockhampton QLD 4700", lat: -23.3830, lng: 150.5089 },
  { name: "Mackay Base Hospital", address: "475 Bridge Rd, Mackay QLD 4740", lat: -21.1585, lng: 149.1655 },
  { name: "Townsville University Hospital", address: "100 Angus Smith Dr, Douglas QLD 4814", lat: -19.3205, lng: 146.7625 },
  { name: "Cairns Hospital", address: "165 The Esplanade, Cairns QLD 4870", lat: -16.9110, lng: 145.7727 },
  // NSW
  { name: "Royal Prince Alfred Hospital", address: "50 Missenden Rd, Camperdown NSW 2050", lat: -33.8894, lng: 151.1826 },
  { name: "St Vincent's Hospital Sydney", address: "390 Victoria St, Darlinghurst NSW 2010", lat: -33.8797, lng: 151.2213 },
  { name: "Westmead Hospital", address: "Cnr Hawkesbury & Darcy Rds, Westmead NSW 2145", lat: -33.8027, lng: 150.9878 },
  { name: "Mount Druitt Hospital", address: "75 Railway St, Mount Druitt NSW 2770", lat: -33.7666, lng: 150.8175 },
  { name: "Liverpool Hospital", address: "Cnr Elizabeth & Goulburn Sts, Liverpool NSW 2170", lat: -33.9203, lng: 150.9241 },
  { name: "Royal North Shore Hospital", address: "Reserve Rd, St Leonards NSW 2065", lat: -33.8221, lng: 151.1908 },
  { name: "John Hunter Hospital", address: "Lookout Rd, New Lambton Heights NSW 2305", lat: -32.9209, lng: 151.6963 },
  { name: "Wollongong Hospital", address: "Loftus St, Wollongong NSW 2500", lat: -34.4213, lng: 150.8891 },
  { name: "Gosford Hospital", address: "75 Holden St, Gosford NSW 2250", lat: -33.4245, lng: 151.3391 },
  { name: "Tweed Valley Hospital", address: "771 Cudgen Rd, Cudgen NSW 2487", lat: -28.2647, lng: 153.5520 },
  // VIC
  { name: "Royal Melbourne Hospital", address: "300 Grattan St, Parkville VIC 3050", lat: -37.7987, lng: 144.9560 },
  { name: "The Alfred Hospital", address: "55 Commercial Rd, Melbourne VIC 3004", lat: -37.8460, lng: 144.9820 },
  { name: "St Vincent's Hospital Melbourne", address: "41 Victoria Pde, Fitzroy VIC 3065", lat: -37.8076, lng: 144.9750 },
  { name: "Sunshine Hospital", address: "176 Furlong Rd, St Albans VIC 3021", lat: -37.7626, lng: 144.8140 },
  { name: "Monash Medical Centre", address: "246 Clayton Rd, Clayton VIC 3168", lat: -37.9207, lng: 145.1225 },
  { name: "Casey Hospital", address: "62-70 Kangan Dr, Berwick VIC 3806", lat: -38.0480, lng: 145.3480 },
  { name: "Dandenong Hospital", address: "135 David St, Dandenong VIC 3175", lat: -37.9762, lng: 145.2138 },
  { name: "Frankston Hospital", address: "2 Hastings Rd, Frankston VIC 3199", lat: -38.1512, lng: 145.1256 },
  { name: "Geelong University Hospital", address: "Bellerine St, Geelong VIC 3220", lat: -38.1530, lng: 144.3620 },
  // SA / WA / TAS / NT / ACT
  { name: "Royal Adelaide Hospital", address: "Port Rd, Adelaide SA 5000", lat: -34.9206, lng: 138.5850 },
  { name: "Flinders Medical Centre", address: "Flinders Dr, Bedford Park SA 5042", lat: -35.0225, lng: 138.5690 },
  { name: "Royal Perth Hospital", address: "197 Wellington St, Perth WA 6000", lat: -31.9535, lng: 115.8660 },
  { name: "Fiona Stanley Hospital", address: "11 Robin Warren Dr, Murdoch WA 6150", lat: -32.0715, lng: 115.8360 },
  { name: "Royal Hobart Hospital", address: "48 Liverpool St, Hobart TAS 7000", lat: -42.8842, lng: 147.3312 },
  { name: "Launceston General Hospital", address: "274-280 Charles St, Launceston TAS 7250", lat: -41.4478, lng: 147.1436 },
  { name: "Royal Darwin Hospital", address: "105 Rocklands Dr, Tiwi NT 0810", lat: -12.3785, lng: 130.8797 },
  { name: "Canberra Hospital", address: "Yamba Dr, Garran ACT 2605", lat: -35.3452, lng: 149.1013 },
];

export function nearestHospital(lat: number, lng: number): Hospital {
  const rad = (d: number) => (d * Math.PI) / 180;
  let best = HOSPITALS[0];
  let bestDist = Infinity;
  for (const h of HOSPITALS) {
    const dLat = rad(h.lat - lat);
    const dLng = rad(h.lng - lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat)) * Math.cos(rad(h.lat)) * Math.sin(dLng / 2) ** 2;
    const dist = 2 * Math.asin(Math.sqrt(a));
    if (dist < bestDist) {
      bestDist = dist;
      best = h;
    }
  }
  return best;
}
