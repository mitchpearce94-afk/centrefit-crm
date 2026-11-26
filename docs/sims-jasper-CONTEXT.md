# SIM cards (M2M One / Jasper) — CONTEXT

**Shipped 27 Nov 2026.** Centrefit's duress-intercom and alarm-reporting SIMs are M2M One
services (Optus, some Telstra) managed in Cisco Jasper Control Centre. The CRM reads them live
under **NBN → SIMs** and stores one thing of its own: which site asset each SIM belongs to.

## Source: Sue's forward, 26 Nov 2026
Liam Velkos (BDM, M2M One, liam.velkos@m2mone.com.au, 0455 333 114) sent Sue the Optus failover
plan pricing and an "API Integration" PDF. Key points from the PDF:

- Control Centre UI: https://m2mone.jasperwireless.com (Liam also linked optus.jasperwireless.com — same cluster).
- **REST** (what we use): per-user key, generated in Control Centre → user menu → *Generate REST API Key*.
  Auth = HTTP Basic `username:key`. Base URL `https://restapi-telstra.jasper.com/rws/api/v1` for
  both carriers (verified: host resolves and answers 401 without auth; `restapi-optus` does not exist).
- **SOAP** (not used): shared M2M One keys — Telstra `9cb32c13-fd86-4db6-9d4f-a15475db56a6`,
  Optus `a90a8fe3-f05e-435d-bd64-ae6606a5d76c`, push secret `M2M`; endpoint `https://api-telstra.jasper.com`.
  These are instance-wide, not Centrefit secrets.
- Support: support@m2mone.com.au, 03 8378 2700 (Mon–Fri 9–5 Melbourne); custom code = billable design services.
- Liam set an automation rule: email alert when a SIM makes an outbound call > 1 min (ICCID only in the alert).

Optus group data plans quoted (1–99 services, ex GST/month): 10 GB $59 · 15 GB $80 · 20 GB $95 ·
50 GB $110 · 100 GB $120 · 200 GB $140 · 500 GB $195 · 1 TB $380. Liam wants the ICCID of the
5G failover SIM to move up a plan — do that from the SIM's detail page once creds are in.

## Env (Vercel, Production)
| Var | Value |
|---|---|
| `JASPER_USERNAME` | the Control Centre login that generated the key |
| `JASPER_REST_API_KEY` | from *Show REST API Key* |
| `JASPER_BASE_URL` | optional override; default restapi-telstra |

Until both are set the tab shows a setup card with these steps. Never put the key in the repo.

## Code
- `src/lib/jasper/client.ts` — Basic-auth client. `listDeviceIccids` (Jasper's `/devices` needs
  `modifiedSince`; we pass the epoch), `fetchDevice`, `fetchDeviceUsage` (`/ctdUsages`, bytes),
  `fetchSessionInfo`, `fetchAuditTrails` + `listRatePlanNames` (best effort — may be locked down),
  `fetchFleet` (6-wide pool), `updateDevice` (PUT status/ratePlan, then `revalidateTag`).
  Reads are Next-data-cached 5 min, tagged `jasper` + `jasper-device-<iccid>`.
- `src/lib/jasper/links.ts` — joins Jasper devices to `site_assets` by `iccid`; suggests the SIM
  asset whose `serial` (historically the phone number) equals the MSISDN.
- Pages: `/nbn/sims` (list + stats + link-to-site), `/nbn/sims/[iccid]` (usage, session, details,
  change history; actions: link/unlink, change plan, change status).
- API: `PATCH /api/sims/[iccid]` {ratePlan|status} → **nbn.manage**;
  `POST/DELETE /api/sims/[iccid]/link` → **sites.manage_assets**.
- Site page: SIM-card assets show the ICCID (links to the SIM page); the edit form has an ICCID
  field for `has_iccid` types.

## DB (migration `20261127080000_sim_iccid_jasper.sql`, applied via MCP)
`site_assets.iccid TEXT` (unique where not null) · `asset_types.has_iccid` (true for `sim_card`).

## Decisions
- Jasper is the source of truth for status/plan/usage; no SIM table in the CRM (no duplicate data entry).
- Status and plan changes write straight to Jasper after a confirm dialog; deactivation is red.
- Linking reuses the site's existing unlinked SIM-card asset (26 exist, 6 with a phone in `serial`)
  before creating one, so the duress paperwork rows stay intact.

## Open
- Generate the REST key (Mitchell/Sue) and set the env vars — nothing is verified against the live
  API until then; `/ratePlans` and `/auditTrails` in particular may 403 on this account.
- Consider a nightly usage snapshot if we want trend lines or "SIM near cap" alerts.
