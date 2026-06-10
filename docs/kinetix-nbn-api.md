# Kinetix Revolution (Rev3) NBN API — build reference

Distilled from the full swagger (Mitchell, 2026-06-10). Base `https://rev3.kinetix.net.au/api/v2/nbn`,
auth headers X-Apikey / X-APISecret / X-UserRef. Full swagger lives in the Rev3 portal
(`/api/v2/nbn/swagger.json`, portal-session gated).

## Critical facts
- **ALL write operations take QUERY PARAMETERS, not JSON bodies.**
- **`TESTING_MODE=true`** on writes → Revolution simulates, nothing reaches NBN. Response
  contains a `testingMode` field — its ABSENCE may mean the request went live. Test refs:
  LOC/APT/AVC/ORD/EUP/PRI/WRI + 12 zeros return canned example responses.
- `order_reference` (RSP ref): ≤35 chars, `[a-zA-Z0-9_\-.]` only.
- Errors: `{type, code, reason}` arrays; ValidationException can arrive in HTTP 200.

## Order chain (Connect)
1. `/address/search` → LOC ID
2. `/service_qualification/single_site?loc_id=` → tech, service class, lines (CPI) / NTDs+ports
3. `/product_qualification/service_types?location_ref=` → service types
4. `/product_qualification/bandwidths?location_ref=&service_type=[&cpi_ref=]` → bandwidth_product_sku list
5. `/product_qualification/restoration_sla?location_ref=&bandwidth_product_sku=` → restoration_sla_sku list
6. Party: `/party/end_users` (search) or POST `/party/end_users/{residential|business}` → EUP ref
   - residential: contact_name (req), phone_number, email_address
   - business: company_name + trading_name (req), contact_name, phone_number, email_address, business_id (ABN), business_size
7. (If appointment needed) `/appointments/query/new?location_id=&start_date_time=&demand_type=&appointment_sla=&priority_assist=` →
   POST `/appointments/reserve` (location_id, demand_type, appointment_sla, slot times, end_user_contact_type/name/phone req, priority_assist req) → APT ref
8. POST `/orders/products/{ncas|nfas|nhas|nwas}`:
   - Always: location_id, bandwidth_product_sku, restoration_sla_sku, order_reference
   - end_user_ref (EUP) — derives end-user fields
   - NCAS (FTTN/B/C): + copper_pair_id (CPI or "NEW"); SC12 rules re jumpering/splitter/pots_interconnect
   - NFAS (FTTP): + ntd_id (NTD or "NEW"), unid_port_id
   - NHAS (HFC): + ntd_id; SC23 needs delivery fields
   - NWAS (FW): + ntd_id
   - appointment_id when SC requires Standard Install
   - Service transfers: transfer_type, service_ref (AVC), customer_authority_date (≤45 days), local_number_porting
9. Track: GET `/orders/product/{order_id}`, `/history`; DELETE = cancel; `/orders/add_note`
   (nbn_action_required=true → human response in 24h); `/orders/add_appointment`; `/orders/attach_end_user`;
   `/orders/request_more_time`; POST `/orders/watch/{order_ref}` (email alerts)
10. Disconnect: POST `/orders/disconnect_product?product_id=PRI...`
11. Modify: PATCH `/orders/products/{product_instance_ref}` (product_sku, service_restoration_sla, stability_profile…)
12. After order Complete: POST `/provisioning/order?order_ref=&protocol=IPoE[&fixed_ip=][&ipv6_method=DHCPv6]` →
    GET `/provisioning/order/{order_ref}`; RADIUS live state: `/provisioning/radius/{any ref}`

## Callbacks (webhooks)
POST `/callbacks/register?href=&resource={orders|appointments|outages|diagnostics|product_inventory|service_health|quotes}
[&query=$.event.externalId='…'][&token_name=bearer&token_value=…]`
Events include order Accepted/Rejected/Completed/Scheduled/RSPActionRequired, appointment Booked/TechOnSite/Completed,
outage lifecycle, diagnostics lifecycle. List `/callbacks/list`, DELETE `/callbacks/{id}`.

## Diagnostics
POST `/diagnostics/avc/service_test?avc_ref=&test={type}` — test types per service from
`/diagnostics/service/{ref}/test_types`. Conditional params: traffic_class (Performance Test),
resync_type+monitoring_duration (Line Quality), force_test (Metallic Line on NFAS), force_measurement (SELT).
Results: `/diagnostics/{test_ref}`, `/diagnostics/service/{ref}` (30 days), `/latest`.

## Also available (later)
- `/address/{loc_id}/services` — our services at a location
- `/provisioning/radius/{ref}` — live session, IP, CPE MAC/vendor, recent dropouts (support gold)
- `/network_performance/cell_performance` — FW cell reports
- `/service_health/telemetry/{avc}` — time-series health telemetry
- `/resource_planning/{loc}` — COAT status; `/quotes` — EE FBC quotes; orders/delayed — Revolution-held orders
