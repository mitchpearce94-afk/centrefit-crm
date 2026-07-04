# Datasheet registry — key handover products

Source hunt run 2026-07-05 (three parallel agents, every URL fetched and verified as a
PDF matching the exact model). Phase D of docs/documentation-CONTEXT.md ingests these
into the `datasheets` bucket keyed to product/model — treat this file as the seed list,
not the runtime source. Confidence: high = official manufacturer PDF; medium = verified
distributor copy (Ubiquiti no longer publishes PDFs for new gear — techspecs.ui.com is
canonical; distributor exports use the official format).

## CCTV (Dahua)
| Model | Product | Datasheet | Confidence |
|---|---|---|---|
| DH-IPC-HDW3667EM-S-IL-ANZ | 6MP WizSense eyeball camera (covers -BLK) | https://materialfile.dahuasecurity.com/uploads/soft/20250416/DH-IPC-HDW3667EM-S-IL-ANZ.pdf | high |
| DHI-NVR5432-16P-AI/ANZ | 32ch 16PoE WizSense NVR | https://material.dahuasecurity.com/uploads/soft/20230217/NVR5432-16P-AIANZ.pdf | high |

## Network (Ubiquiti)
| Model | Product | Datasheet | Confidence |
|---|---|---|---|
| U7 Pro | UniFi WiFi 7 AP | https://download.axilogi.com/Ubiquiti/Datasheet/U7-Pro.pdf | medium (official specs: techspecs.ui.com/unifi/wifi/u7-pro) |
| USW-48-PoE | UniFi 48-port PoE switch (sheet covers 16/24/48) | https://dl.ui.com/ds/usw_poe_ds.pdf | high |
| USW-Pro-Max-48-PoE | UniFi Pro Max 48 PoE | https://download.axilogi.com/Ubiquiti/Datasheet/USW-Pro-Max-48-PoE.pdf | medium |
| UCG-Fiber | UniFi Cloud Gateway Fiber | https://download.axilogi.com/Ubiquiti/Datasheet/UCG-Fiber.pdf | medium |

## AV / RF (Electrocraft, Power Dynamics, Kingray)
| Model | Product | Datasheet | Confidence |
|---|---|---|---|
| EPS-HDM1001M4 | Electrocraft 1× HDMI DVB-T modulator (MPEG4) — note: exact model is HDM1001, not HDMI1001 | https://www.electrocraft.com.au/Products/StockInformation/OpenAttachment?stockItemNo=7375&attachmentNo=1185&attachmentID=85102856-6F47-45F1-8C5C-6BFE68C82475 | high |
| PRM240 | Power Dynamics 100V 6-ch mixer-amplifier 240W (sheet covers PRM120/240) | https://www.tronios.com/fileuploader/download/download/?d=0&file=custom%2Fupload%2F952.154_952.156+PRM+Series+100V+4Z+Mixer-Amplifier_manual_V2.0.pdf | high |
| NCSP6 | Power Dynamics 100V ceiling speaker (NCSP series sheet) | https://www.tronios.com/fileuploader/download/download/?d=0&file=custom%2Fupload%2F952.604_952.605_952.606_952.607_952.608_952.609+NCSP+Series+Ceiling+Speaker+100V_manual_V1.1.pdf | medium — confirm NCSP6 vs CSPB6 |
| BD50TB | Power Dynamics 100V wall speaker (BD series sheet) | https://www.tronios.com/fileuploader/download/download/?d=0&file=custom%2Fupload%2F952.126_952.128_952.130_952.132+BD+Series+In%26Outdoor+IP65+Speaker+100V_manual_V1.3.pdf | medium — confirm size/colour variant |
| KAT8F | Kingray 8-way active tap (sheet covers KAT8F/16F/24F/32F) | https://www.kingray.net.au/app/uploads/KAT8F_KAT16F_KAT24F_KAT32F_TechSheet-2.pdf | high |

## Duress intercom — MITCHELL TO CONFIRM which one we install
| Candidate | Product | Datasheet / page | Notes |
|---|---|---|---|
| ELK "Seven Intercom" | AU-made 24/7 gym duress intercom, Telstra SIM, battery backup, direct to control room | https://www.elksecurity.com.au/shop/seven-intercom/ (no public PDF — datasheet via admin@elksecurity.com.au) | Strongest match |
| ASC Global InterCom 4G Emergency Caller WM | Wall-mount single SOS button, 2-way audio, 4G | https://www.ascglobal.eu/custom/tellsystemcommunication/image/data/srattached/229adfd82ce4c3188bcbf8f592e91cc5_intercom_module_types_user_manual_en_2025.pdf | EU brand, AU distribution unconfirmed |
| Guardian Telecom HDE-20 | Wall-mount hands-free emergency phone (analog + 4G gateway) | https://www.covertel.com.au/wp-content/uploads/2022/04/hde-series-v2-10may21.pdf | Different architecture (not standalone 4G) |

## Bosch security (+ MyAlarm)
Bosch's datasheet CDN moved to `resources.keenfinity.tech` (Keenfinity = Bosch
Security's successor brand). Beware `assets.catalog.boschbuildingtechnologies.com` /
`cdn.commerce.boschsecurity.com` — they soft-404 (HTTP 200 HTML for any path).

| Model | Product | Datasheet | Confidence |
|---|---|---|---|
| DS936 | 360° ceiling-mount panoramic PIR | https://resources.keenfinity.tech/public/documents/DS936_Series_Data_sheet_enUS_2628645131.pdf | high |
| CC610GWP | Solution 6000 control panel PCB + CP736B keypad | https://resources.seadan.com.au/resources/products/BOSCH7053/attachments/BOSCH7053_1xCC610PB-family-datasheet_1.pdf | high (AU distributor copy of the official sheet) |
| ISC-BPQ2-W12 | Blue Line Gen2 Quad PIR (12m) | https://resources.keenfinity.tech/public/documents/ISC_BPQ2_W12_Data_sheet_enUS_2603527307.pdf | high |
| RFPB-SB | RADION single-button panic pendant (sheet covers SB + TB) | https://resources.keenfinity.tech/public/documents/RADION_TB_and_SB_Data_sheet_enUS_13001529227.pdf | high |
| MY368AU | MyAlarm dual-SIM IP + 4G combo module (DigiFlex/Suretek, NOT Bosch) | https://www.myalarm.com.au/brochures/installer.pdf | medium — installer brochure; no dedicated datasheet exists |
