// Shared by the cockpit page (server) and RunTest (client): flatten Kinetix
// payloads into readable label/value rows (plain-English labels, noise
// dropped) and render timestamps in our time.

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export function formatValue(v: unknown): string {
  if (typeof v === "string" && ISO_RE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("en-AU", {
        timeZone: "Australia/Brisbane",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    }
  }
  return String(v);
}

// Whole branches that are pure spec noise — never shown.
const DROP_KEYS = new Set(["productSpecification", "testSpecificationRef", "specificationType", "href"]);
const DROP_LEAVES = /transientId|^href$|^version$/i;

// Plain-English labels for Kinetix field names.
const LEAF_DICT: Record<string, string> = {
  id: "Reference",
  status: "Status",
  state: "Status",
  result: "Result",
  type: "Type",
  firstActivationDate: "Activated",
  accessServiceTechnologyType: "Technology",
  serviceRestorationSla: "Restoration SLA",
  batteryBackupService: "Battery backup",
  informedConsent: "Informed consent",
  priorityAssist: "Priority assist",
  orderSla: "Order SLA",
  endUserType: "End user type",
  customerRef: "Customer ref",
  bandwidthProfile: "Speed tier",
  startDateTime: "Started",
  endDateTime: "Finished",
  avcType: "AVC type",
  accessLoopIdentification: "Access loop",
  cvcId: "CVC",
  nniCvlanId: "NNI C-VLAN",
  connectedToUni: "UNI port",
  ntdType: "NTD type",
  ntdLocation: "NTD location",
  ntdPowerType: "NTD power",
  ntdVersion: "NTD version",
  csaId: "CSA",
  poiId: "POI",
  location: "Location",
  serviceabilityStatus: "Serviceability",
  primaryAccessTechnology: "Technology",
  serviceabilityClass: "Service class",
};

// parentKey.leaf pairs that deserve their own label.
const PAIR_DICT: Record<string, string> = {
  "billingAccount.id": "Billing account",
  "relatedPlace.id": "Location (LOC)",
  "relatedParty.id": "End user (BIZ)",
  "serviceRef.id": "Service",
  "serviceTestResults.type": "Test type",
  "serviceTestResults.status": "Test status",
  "serviceTestResults.result": "Result",
  "executionDate.startDateTime": "Started",
  "executionDate.endDateTime": "Finished",
};

function humanize(s: string): string {
  const w = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// AVC000…/NTD000… ids name the thing an array item IS — use as group context.
function groupFromId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const p = id.slice(0, 3).toUpperCase();
  return ["AVC", "NTD", "UNI", "CVC", "CSA"].includes(p) ? (p === "UNI" ? "UNI port" : p) : null;
}

/**
 * Recursively flatten an object into readable [label, value] rows. Nested
 * results (e.g. test measurements) surface with plain labels like
 * "Test type · NTD Status" instead of serviceTest.serviceTestResults.type.
 */
export function flattenRows(data: unknown, maxRows = 28): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const seen = new Set<string>();

  const leafLabel = (parentKey: string, key: string, group: string | null): string => {
    const pair = PAIR_DICT[`${parentKey}.${key}`];
    const base = pair ?? LEAF_DICT[key] ?? humanize(key);
    return group ? `${group} · ${base}` : base;
  };

  const walk = (val: unknown, parentKey: string, key: string, group: string | null, depth: number) => {
    if (rows.length >= maxRows || val == null) return;
    if (DROP_KEYS.has(key) || DROP_LEAVES.test(key)) return;
    if (["string", "number", "boolean"].includes(typeof val)) {
      const label = leafLabel(parentKey, key, group);
      const line = `${label}=${val}`;
      if (seen.has(line)) return;
      seen.add(line);
      rows.push([label, formatValue(val)]);
      return;
    }
    if (depth >= 4) return;
    if (Array.isArray(val)) {
      if (val.length === 0) return;
      if (["string", "number", "boolean"].includes(typeof val[0])) {
        rows.push([leafLabel(parentKey, key, group), val.slice(0, 6).map(String).join(", ") + (val.length > 6 ? "…" : "")]);
        return;
      }
      for (const item of val.slice(0, 4)) {
        const g = groupFromId((item as Record<string, unknown>)?.id) ?? group;
        walk(item, parentKey, key, g, depth + 1);
      }
      return;
    }
    if (typeof val === "object") {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (k.startsWith("@")) continue;
        walk(v, key, k, group, depth + 1);
      }
    }
  };

  walk(Array.isArray(data) ? data[0] : data, "", "", null, 0);
  return rows;
}
