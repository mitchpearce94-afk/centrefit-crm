/**
 * Guided quote — the question set for a quote with no plan (docs/quoting-v2
 * D4). Answers become the same device counts and site fields a plan produces,
 * so the SAME engine (device types → products → rules → kits → labour → scope)
 * builds the quote. "Anyone can do it without knowing the specifics."
 *
 * Kept as data so it can move to a table later without touching the UI.
 */
import type { DeviceCounts, SiteInfo } from './constants'

export type QuestionType = 'number' | 'yesno' | 'choice'
export interface Question {
  id: string
  prompt: string
  help?: string
  type: QuestionType
  /** where the answer lands */
  target: { kind: 'device'; code: string } | { kind: 'site'; field: keyof SiteInfo } | { kind: 'flag'; key: 'isInterstate' | 'elecDoingRoughIn' | 'elecDoingFitOff' } | { kind: 'cabinet' } | { kind: 'none' }
  choices?: { value: string; label: string }[]
  /** only show when another answer is truthy */
  showIf?: string
  /** yesno → this count when yes */
  yesValue?: number
}
export interface SystemDef { id: string; label: string; blurb: string; questions: Question[] }

export const INTERVIEW: SystemDef[] = [
  {
    id: 'alarm', label: 'Alarm', blurb: 'Panel, detectors, keypad, sirens, monitoring.',
    questions: [
      { id: 'alarm_panel', prompt: 'New alarm panel?', help: 'The K6000 kit brings its keypad, comms, relays and power with it.', type: 'yesno', target: { kind: 'device', code: 'alarm_panel' }, yesValue: 1 },
      { id: 'pir_360_roof', prompt: 'Ceiling PIRs (360°)', type: 'number', target: { kind: 'device', code: 'pir_360_roof' } },
      { id: 'pir_wall', prompt: 'Wall PIRs', type: 'number', target: { kind: 'device', code: 'pir_wall' } },
      { id: 'reed_switch', prompt: 'Reed switches (doors, roller doors)', type: 'number', target: { kind: 'device', code: 'reed_switch' } },
      { id: 'reed_switch_uncabled', prompt: 'How many of those are wireless?', type: 'number', target: { kind: 'site', field: 'reed_switch_uncabled' }, showIf: 'reed_switch' },
      { id: 'light_siren', prompt: 'External sirens / strobes', type: 'number', target: { kind: 'device', code: 'light_siren' } },
      { id: 'alarm_keypad', prompt: 'Extra keypads beyond the one in the kit', type: 'number', target: { kind: 'device', code: 'alarm_keypad' } },
    ],
  },
  {
    id: 'duress', label: 'Duress', blurb: 'Buttons, intercoms, pendants.',
    questions: [
      { id: 'duress_button', prompt: 'Duress buttons', type: 'number', target: { kind: 'device', code: 'duress_button' } },
      { id: 'duress_intercom', prompt: 'Duress intercoms (GSM)', type: 'number', target: { kind: 'device', code: 'duress_intercom' } },
      { id: 'rf_receiver', prompt: 'Wireless pendants needed?', help: 'Adds the RF receiver; pendant count follows the site size rule.', type: 'yesno', target: { kind: 'device', code: 'rf_receiver' }, yesValue: 1 },
    ],
  },
  {
    id: 'cctv', label: 'CCTV', blurb: 'Cameras, recorder, drives sized for 30 days.',
    questions: [
      { id: 'camera_white', prompt: 'Cameras — white', type: 'number', target: { kind: 'device', code: 'camera_white' } },
      { id: 'camera_black', prompt: 'Cameras — black', type: 'number', target: { kind: 'device', code: 'camera_black' } },
      { id: 'external_camera_count', prompt: 'How many cameras are outside (wall mount)?', type: 'number', target: { kind: 'site', field: 'external_camera_count' } },
      { id: 'concrete_mount_white', prompt: 'Concrete ceiling — white cameras needing a roof mount', type: 'number', target: { kind: 'site', field: 'concrete_mount_white' } },
      { id: 'concrete_mount_black', prompt: 'Concrete ceiling — black cameras needing a roof mount', type: 'number', target: { kind: 'site', field: 'concrete_mount_black' } },
    ],
  },
  {
    id: 'access', label: 'Access control', blurb: 'Locks, readers, exits, break glass.',
    questions: [
      { id: 'mag_lock', prompt: 'Doors with a mag lock', type: 'number', target: { kind: 'device', code: 'mag_lock' } },
      { id: 'mag_lock_glass', prompt: 'How many of those doors are glass?', help: 'Glass doors take the AMAB4300 armature; others the mounting plate.', type: 'number', target: { kind: 'site', field: 'mag_lock_glass' }, showIf: 'mag_lock' },
      { id: 'door_strike', prompt: 'Doors with an electric strike', type: 'number', target: { kind: 'device', code: 'door_strike' } },
      { id: 'card_reader', prompt: 'Doors with a reader / scanner', help: 'Snap supplies its own readers (labour only); Planet Fitness gets the Veyla kit.', type: 'number', target: { kind: 'device', code: 'card_reader' } },
      { id: 'rex_button', prompt: 'Exit (REX) buttons', type: 'number', target: { kind: 'device', code: 'rex_button' } },
      { id: 'break_glass', prompt: 'Break glass / emergency door releases', type: 'number', target: { kind: 'device', code: 'break_glass' } },
    ],
  },
  {
    id: 'tailgate', label: 'Tailgating', blurb: 'Veyla Protect camera per door.',
    questions: [{ id: 'tailgate_system', prompt: 'Doors with a tailgating system', type: 'number', target: { kind: 'device', code: 'tailgate_system' } }],
  },
  {
    id: 'data', label: 'Data & Wi-Fi', blurb: 'Access points, data points, cabinet, switch.',
    questions: [
      { id: 'wap', prompt: 'Wi-Fi access points', type: 'number', target: { kind: 'device', code: 'wap' } },
      { id: 'data_point', prompt: 'Data points (cable runs)', help: 'Cable and labour only — no part.', type: 'number', target: { kind: 'device', code: 'data_point' } },
      { id: 'integration_cable', prompt: 'Integration cables (equipment tie-ins)', type: 'number', target: { kind: 'device', code: 'integration_cable' } },
      { id: 'cabinet', prompt: 'Server cabinet', type: 'choice', target: { kind: 'cabinet' }, choices: [{ value: '', label: 'None / existing' }, { value: 'cabinet_9ru', label: '9RU' }, { value: 'cabinet_27ru', label: '27RU' }, { value: 'cabinet_32ru', label: '32RU' }, { value: 'cabinet_42ru', label: '42RU' }] },
    ],
  },
  {
    id: 'av', label: 'AV & audio', blurb: 'TVs, cardio feeds, speakers.',
    questions: [
      { id: 'tv_count', prompt: 'Wall TVs', type: 'number', target: { kind: 'site', field: 'tv_count' } },
      { id: 'ceiling_tv_count', prompt: 'Ceiling TVs', type: 'number', target: { kind: 'site', field: 'ceiling_tv_count' } },
      { id: 'cardio_count', prompt: 'Cardio machines with a TV feed', type: 'number', target: { kind: 'site', field: 'cardio_count' } },
      { id: 'speaker_roof_white', prompt: 'Ceiling speakers — white', type: 'number', target: { kind: 'device', code: 'speaker_roof_white' } },
      { id: 'speaker_roof_black', prompt: 'Ceiling speakers — black', type: 'number', target: { kind: 'device', code: 'speaker_roof_black' } },
      { id: 'speaker_wall_white', prompt: 'Wall speakers — white', type: 'number', target: { kind: 'device', code: 'speaker_wall_white' } },
      { id: 'speaker_wall_black', prompt: 'Wall speakers — black', type: 'number', target: { kind: 'device', code: 'speaker_wall_black' } },
      { id: 'separate_studio_zone', prompt: 'Separate studio audio zone?', type: 'yesno', target: { kind: 'site', field: 'separate_studio_zone' } },
      { id: 'volume_control', prompt: 'Volume controls', type: 'number', target: { kind: 'device', code: 'volume_control' } },
      { id: 'coax_point', prompt: 'Coax points (cable runs)', type: 'number', target: { kind: 'device', code: 'coax_point' } },
    ],
  },
]

export const SITE_QUESTIONS: Question[] = [
  { id: 'site_sqm', prompt: 'Site size (sqm)', help: 'Cable rolls and pendant counts depend on it.', type: 'number', target: { kind: 'site', field: 'site_sqm' } },
  { id: 'isInterstate', prompt: 'Interstate job?', type: 'yesno', target: { kind: 'flag', key: 'isInterstate' } },
  { id: 'elecDoingRoughIn', prompt: 'Electrician doing the rough-in?', help: 'Strips our rough-in cable and brackets.', type: 'yesno', target: { kind: 'flag', key: 'elecDoingRoughIn' } },
  { id: 'elecDoingFitOff', prompt: 'Electrician doing the fit-off?', type: 'yesno', target: { kind: 'flag', key: 'elecDoingFitOff' } },
]

export type InterviewAnswers = Record<string, number | boolean | string>

export interface InterviewResult {
  deviceCounts: DeviceCounts
  siteInfo: SiteInfo
  flags: { isInterstate: boolean; elecDoingRoughIn: boolean; elecDoingFitOff: boolean }
  systems: string[]
  answers: InterviewAnswers
}

export function interviewToQuote(systems: string[], answers: InterviewAnswers): InterviewResult {
  const deviceCounts: DeviceCounts = {}
  const siteInfo: SiteInfo = {}
  const flags = { isInterstate: false, elecDoingRoughIn: false, elecDoingFitOff: false }
  const apply = (q: Question) => {
    const a = answers[q.id]
    if (a === undefined || a === '' || a === null) return
    switch (q.target.kind) {
      case 'device': { const n = q.type === 'yesno' ? (a ? (q.yesValue ?? 1) : 0) : Number(a) || 0; if (n > 0) deviceCounts[q.target.code] = n; break }
      case 'site': { (siteInfo as Record<string, unknown>)[q.target.field] = q.type === 'yesno' ? Boolean(a) : Number(a) || 0; break }
      case 'flag': flags[q.target.key] = Boolean(a); break
      case 'cabinet': if (typeof a === 'string' && a) deviceCounts[a] = 1; break
    }
  }
  for (const s of INTERVIEW) if (systems.includes(s.id)) for (const q of s.questions) apply(q)
  for (const q of SITE_QUESTIONS) apply(q)
  // door_count is derived for the rules that key off it: a door has a lock
  // (mag or strike) and usually a reader — take the larger of the two views.
  const lockedDoors = (deviceCounts.mag_lock || 0) + (deviceCounts.door_strike || 0)
  siteInfo.door_count = Math.max(siteInfo.door_count || 0, lockedDoors, deviceCounts.card_reader || 0)
  // TV mounts follow the TVs unless the site says otherwise
  if (siteInfo.tv_count && !siteInfo.wall_tv_mount_count) siteInfo.wall_tv_mount_count = siteInfo.tv_count
  if (siteInfo.ceiling_tv_count && !siteInfo.ceiling_tv_mount_count) siteInfo.ceiling_tv_mount_count = siteInfo.ceiling_tv_count
  return { deviceCounts, siteInfo, flags, systems, answers }
}

export const GUIDED_STORAGE_KEY = 'cf-guided-quote'
