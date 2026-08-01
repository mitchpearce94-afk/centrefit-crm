/**
 * Proposal copy — the single source of truth shared by the proposal PDF
 * (proposal-pdf.tsx) and the web proposal page (/proposal/[token]).
 *
 * Copy is deliberately hardcoded (Mitchell's choice — no CMS); everything
 * client-specific merges in from the quote + scope at render time. Bumping a
 * company stat or adding a testimonial here updates BOTH documents, so the
 * PDF a customer downloads can never drift from the page they were sent.
 */

export const COMPANY = {
  legal: "Centrefit Group Pty Ltd",
  abn: "ABN 55 168 413 161",
  phone: "(07) 3188 5115",
  email: "sales@centrefit.com.au",
  web: "centrefit.com.au",
  suburb: "Lawnton QLD 4501",
  stats: [
    { n: "10+", label: "YEARS IN BUSINESS" },
    { n: "100+", label: "FULL FIT-OUTS" },
    { n: "3", label: "COUNTRIES" },
    { n: "24/7", label: "IN-HOUSE MONITORING" },
  ],
  brands: [
    { name: "Snap Fitness", count: "100+ clubs" },
    { name: "Planet Fitness", count: "10+ facilities" },
    { name: "Total Fusion", count: "6+ facilities" },
    { name: "Core Plus", count: "5+ facilities" },
  ],
  award: "Lift Brands Australasia — Supplier of the Year 2022",
  licences: "ASIAL Member 64937  ·  QLD Security Licence Class 1 & 2 — No. 462 6412",
  standards:
    "AS/CA S009:2020  ·  AS 11801.5:2019  ·  AS/NZS 2201.1:2007  ·  AS/NZS IEC 60839.11.1:2019  ·  AS 4806.1",
};

export const WHO_WE_ARE = [
  "Centrefit Group has been designing, installing and supporting the technology that runs Australian businesses since 2014. Security, CCTV, access control, data and Wi-Fi, audio visual and internet — engineered as one system, delivered by one team.",
  "We made our name in 24/7 fitness — more than 100 full fit-outs across every Australian state and territory, plus builds in New Zealand and Singapore — and we bring that same end-to-end approach to offices, retail, medical, industrial and any space that needs to run securely around the clock. Clients from our first year are still with us today, because we treat handover as the start of the relationship, not the end of the job.",
];

export const DIFFERENTIATORS = [
  {
    title: "One team, end to end",
    body: "Security, surveillance, access control, data, AV and internet are one interconnected system — so we deliver them as one. A single contractor, a single point of accountability, and no gaps between trades for problems to hide in.",
  },
  {
    title: "We build our own hardware",
    body: "When off-the-shelf equipment can't solve a problem, we engineer our own. Our Cloud Switch — designed and built by Centrefit — lets us power-cycle critical equipment remotely, resolving most device failures in minutes without a site visit or a call-out fee.",
  },
  {
    title: "Monitored 24/7, in-house",
    body: "Alarm and duress events go straight to our own security control room — not an outsourced call centre — and are recognised and actioned immediately, around the clock, every day of the year.",
  },
  {
    title: "Built around how you operate",
    body: "Staffed and unstaffed hours, after-hours access, shutdown routines, high-traffic entries — we design around the way a facility actually runs. It's the discipline that made us the name in 24/7 fitness, and it travels to any site that has to look after itself around the clock.",
  },
  {
    title: "Compliant, licensed, accountable",
    body: "Every installation is carried out under our Class 1 & 2 security licences and to the relevant Australian Standards, and we're a member of ASIAL — the peak body for the Australian security industry.",
  },
];

export const SUPPORT_CARDS = [
  {
    title: "24/7 control room",
    body: "Incidents and breaches are recognised and actioned by our own operators the moment they happen — nights, weekends and public holidays included.",
  },
  {
    title: "Remote-first fault fixing",
    body: "Panels run dual-path comms (ethernet + 4G) and critical gear sits behind our Cloud Switch, so most faults are diagnosed and fixed remotely — often before you've noticed.",
  },
  {
    title: "Direct to the techs",
    body: "When you call, you talk to the people who designed and built your site — not a ticket queue. Your system, known by name.",
  },
];

export const NBN_PLANS = [
  { name: "Basic", speed: "100/20", evening: "98 / 16", price: "$129", fit: "EFTPOS, VoIP and everyday browsing" },
  { name: "Premium", speed: "250/100", evening: "245 / 84", price: "$149", fit: "4K streaming, CCTV cloud backup, busy sites" },
  { name: "Advanced", speed: "500/200", evening: "491 / 168", price: "$169", fit: "Heavy cloud and SaaS workloads, zero slowdowns" },
  { name: "Ultimate", speed: "1000/400", evening: "600 / 336", price: "$239", fit: "Enterprise workloads, multi-site VPN and failover" },
  { name: "Extreme", speed: "2000/500", evening: "1200 / 420", price: "$339", fit: "Data-intensive operations on hyperfast fibre" },
];

export const OFFERINGS = [
  { name: "Business NBN & ISP", desc: "Business-grade internet managed end to end — plans and pricing included in this proposal." },
  { name: "24/7 alarm monitoring", desc: "Back-to-base monitoring actioned by our own control room." },
  { name: "Maintenance & health checks", desc: "Scheduled CCTV, security and network checks that catch faults early." },
  { name: "Access control expansion", desc: "New doors, readers and integrations as your facility grows." },
  { name: "AV & entertainment", desc: "TVs, audio zones and music-system integration, tuned and commissioned." },
  { name: "Relocations & refits", desc: "Moving or renovating? We lift, redesign and recommission the lot." },
];

export const TESTIMONIALS = [
  {
    quote: "We have had a Snap Fitness club for 13 years. Mark has always been beyond helpful, attentive, knowledgeable, responsive, professional and personable. Whenever we have any issues within the club, I can count on Mark to come to the rescue.",
    who: "Snap Fitness Noosa",
  },
  {
    quote: "We recently worked with Centrefit to move and revamp our gym. Mark and his team were outstanding — professional, efficient and detail-orientated. They made the entire process seamless.",
    who: "Snap Fitness The Gap",
  },
  {
    quote: "Pleasure to work with — strong communication, met deadlines, and nothing was too much to get the job done. I wish they did my two other clubs.",
    who: "Snap Fitness Golden Bay",
  },
  {
    quote: "We had a situation that Mark and the team wouldn't stop working on until it was fixed so our staff could go home. His patience and knowledge saved us a lot of time and money.",
    who: "Snap Fitness Craigieburn",
  },
];
