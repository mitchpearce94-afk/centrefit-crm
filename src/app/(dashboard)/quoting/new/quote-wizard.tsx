"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import { useToast } from "@/components/ui/toast";
import {
  DEVICE_TYPES,
  DEFAULT_EXTRAS,
  generateBOM,
  calculateBOMTotals,
  calculateLabour,
  recalcLabour,
  checkMandatoryLabour,
  calculateQuoteSummary,
  generateScopeOfWorks,
} from "@/lib/quote-engine";
import type {
  DeviceCounts,
  SiteInfo,
  BOMItem,
  LabourData,
  ExtraItem,
  Product,
  QuoteSummary,
  LabourTimingOverrides,
  ElecOptions,
  DependencyRule,
} from "@/lib/quote-engine";

interface CustomerOption {
  id: string;
  name: string;
  customer_sites: { id: string; name: string; address: string | null; suburb: string | null; state: string | null; postcode: string | null }[];
  customer_contacts: { id: string; name: string; phone: string | null; mobile: string | null; email: string | null; is_primary: boolean }[];
}

interface PlanFile {
  id: string;
  name: string;
  client_name: string | null;
  site_name: string | null;
  site_address: string | null;
  state: string | null;
  device_counts: Record<string, number>;
  site_info: Record<string, number | boolean>;
  customer_id: string | null;
  created_at: string;
}

interface QuoteProduct {
  id: string;
  name: string;
  sku: string;
  category: string;
  supplier: string;
  cost_price: number;
  markup: number;
  sell_price: number;
  device_type: string | null;
  scope_role: string | null;
  labour_code: string | null;
  image_url: string | null;
  requires_cable_run: boolean;
  is_default: boolean;
  is_active: boolean;
}

interface RuleTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

interface RuleRow {
  id: string;
  template_id: string | null;
  description: string;
  is_active: boolean;
  is_universal: boolean;
  trigger_code: string | null;
  trigger_condition: string;
  trigger_value: number | null;
  trigger_min: number | null;
  trigger_max: number | null;
  trigger_site_field: string | null;
  trigger_site_value: number | null;
  trigger_site_op: string | null;
  quantity_mode: string;
  quantity_value: number | null;
  quantity_site_field: string | null;
  quantity_multiplier: number | null;
  quantity_divisor: number | null;
  quantity_formula: string | null;
  quantity_custom_key: string | null;
  auto_add_product_id: string | null;
  sort_order: number;
}

function rulesForTemplate(allRules: RuleRow[], templateId: string | null, products: Product[]): DependencyRule[] {
  // Universal rules fire on every quote regardless of template; template-specific
  // rules only fire when their template matches. A rule with no template is
  // included as universal even if the flag isn't set, so older rules don't
  // silently drop out.
  return allRules
    .filter((r) => {
      if (!r.is_active || !r.auto_add_product_id) return false;
      if (r.is_universal) return true;
      if (!templateId) return false;
      return r.template_id === templateId;
    })
    .map<DependencyRule>((r) => {
      const product = products.find((p) => p.id === r.auto_add_product_id);
      return {
        id: r.id,
        preset: "",
        description: r.description,
        is_active: r.is_active,
        trigger_code: r.trigger_code,
        trigger_condition: r.trigger_condition,
        trigger_value: r.trigger_value ?? undefined,
        trigger_min: r.trigger_min ?? undefined,
        trigger_max: r.trigger_max ?? undefined,
        trigger_site_field: r.trigger_site_field ?? undefined,
        trigger_site_value: r.trigger_site_value ?? undefined,
        trigger_site_op: r.trigger_site_op ?? undefined,
        quantity_mode: r.quantity_mode,
        quantity_value: r.quantity_value ?? undefined,
        quantity_site_field: r.quantity_site_field ?? undefined,
        quantity_multiplier: r.quantity_multiplier ?? undefined,
        quantity_divisor: r.quantity_divisor ?? undefined,
        quantity_formula: r.quantity_formula ?? undefined,
        quantity_custom_key: r.quantity_custom_key ?? undefined,
        auto_add_product_id: r.auto_add_product_id ?? undefined,
        auto_add_product_sku: product?.sku ?? null,
        auto_add_product_name: product?.name ?? null,
        sort_order: r.sort_order,
      };
    });
}

const STEPS = ["Client", "Rules", "BOM", "Labour", "Extras", "Summary"];

const DRAFT_KEY = "centrefit-quote-draft";

interface ManualBomItem {
  product_id: string | null;
  product_name: string;
  sku: string;
  category: string;
  supplier: string;
  quantity: number;
  cost_price: number;
  sell_price: number;
  isCustom: boolean;
}

const inputClass =
  "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ExistingQuote {
  quoteId: string;
  ref: string;
  customerId: string;
  siteId?: string;
  jobId?: string;
  planId?: string;
  clientName: string;
  siteName: string;
  siteAddress: string;
  quoteType: string;
  templateId: string | null;
  siteInfo: SiteInfo;
  deviceCounts: DeviceCounts;
  labourData: LabourData | null;
  discountPercent: number;
  electricianCost?: number;
  elecDoingRoughIn?: boolean;
  elecDoingFitOff?: boolean;
  lineItems: any[];
  extras: any[];
}

export function QuoteWizard({
  customers,
  products: rawProducts,
  plans,
  existingQuote,
  billingSettings,
  jobs = [],
  labourTimings = [],
  templates = [],
  allRules = [],
}: {
  customers: CustomerOption[];
  products: QuoteProduct[];
  plans: PlanFile[];
  existingQuote?: ExistingQuote;
  billingSettings?: any;
  jobs?: { id: string; number: string; customer_name: string | null; site_name: string | null }[];
  labourTimings?: { code: string; name: string; minutes_per: number }[];
  templates?: RuleTemplate[];
  allRules?: RuleRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { toast } = useToast();
  const isEditing = !!existingQuote;

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const planImportRef = useRef<HTMLInputElement>(null);
  const [selectedPlanId, setSelectedPlanId] = useState(existingQuote?.planId || "");
  const [quoteType, setQuoteType] = useState<"full" | "progress">(
    (existingQuote?.quoteType as "full" | "progress") || "full"
  );

  // Job linking
  const [linkedJobId, setLinkedJobId] = useState(existingQuote?.jobId || searchParams.get("job") || "");

  // Template selection — must be picked before BOM is generated
  const defaultTemplateId =
    existingQuote?.templateId ??
    templates.find((t) => t.is_default)?.id ??
    templates[0]?.id ??
    null;
  const [templateId, setTemplateId] = useState<string | null>(defaultTemplateId);

  // Step 1: Client
  const [customerId, setCustomerId] = useState(existingQuote?.customerId || "");
  const [siteId, setSiteId] = useState(existingQuote?.siteId || "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [clientName, setClientName] = useState(existingQuote?.clientName || "");
  const [siteName, setSiteName] = useState(existingQuote?.siteName || "");
  const [siteAddress, setSiteAddress] = useState(existingQuote?.siteAddress || "");
  const [siteInfo, setSiteInfo] = useState<SiteInfo>(existingQuote?.siteInfo || {
    site_sqm: 0, door_count: 0, external_camera_count: 0,
    concrete_mount_black: 0, concrete_mount_white: 0,
    cardio_count: 0, tv_count: 0, ceiling_tv_count: 0,
    wall_tv_mount_count: 0, ceiling_tv_mount_count: 0,
    separate_studio_zone: false,
  });

  // Step 2: Devices
  const [deviceCounts, setDeviceCounts] = useState<DeviceCounts>(existingQuote?.deviceCounts || {});

  // Step 3: BOM — rehydrate from saved line items when editing
  const [bomItems, setBomItems] = useState<BOMItem[]>(
    existingQuote?.lineItems?.length
      ? existingQuote.lineItems.map((li: any) => ({
          device_type_code: li.device_type_code ?? null,
          device_type_legend: li.device_type_legend ?? null,
          category: li.category ?? "",
          product_id: li.product_id ?? null,
          product_name: li.product_name ?? "",
          sku: li.sku ?? "",
          supplier: li.supplier ?? "",
          quantity: li.quantity ?? 0,
          cost_price: Number(li.cost_price) || 0,
          markup: Number(li.markup) || 0,
          sell_price: Number(li.sell_price) || 0,
          notes: li.notes ?? "",
          auto_added: !!li.auto_added,
          rule_description: li.rule_description ?? null,
        }))
      : []
  );
  const [bomGenerated, setBomGenerated] = useState(!!existingQuote?.lineItems?.length);

  // Step 4: Labour
  const [labourData, setLabourData] = useState<LabourData | null>(existingQuote?.labourData || null);

  // Step 5: Extras
  const [extras, setExtras] = useState<ExtraItem[]>(
    existingQuote?.extras?.length
      ? existingQuote.extras.map((e: any) => ({ category: e.category, description: e.description, cost: e.cost, sell: e.sell }))
      : DEFAULT_EXTRAS.map((e) => ({ ...e }))
  );

  // Electrician
  const [electricianCost, setElectricianCost] = useState(existingQuote?.electricianCost ?? 0);
  const [elecDoingRoughIn, setElecDoingRoughIn] = useState(existingQuote?.elecDoingRoughIn ?? false);
  const [elecDoingFitOff, setElecDoingFitOff] = useState(existingQuote?.elecDoingFitOff ?? false);
  const isInterstate = siteInfo.state ? siteInfo.state !== 'QLD' : false;

  // Step 6
  const [discountPercent, setDiscountPercent] = useState(existingQuote?.discountPercent ?? 0);

  // Quote mode: plan-based or manual
  const [quoteMode, setQuoteMode] = useState<"plan" | "manual">("plan");

  // Manual mode state
  const [manualScope, setManualScope] = useState("");
  const [manualBomItems, setManualBomItems] = useState<ManualBomItem[]>([]);
  const [manualLabourHours, setManualLabourHours] = useState(0);
  const [manualLabourAmount, setManualLabourAmount] = useState(0);
  const [manualCalloutDays, setManualCalloutDays] = useState(0);
  const [manualBomSearch, setManualBomSearch] = useState("");

  // Draft persistence
  const [showDraftBanner, setShowDraftBanner] = useState(false);

  // Map products
  const products: Product[] = useMemo(() =>
    rawProducts.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, category: p.category,
      supplier: p.supplier, cost_price: p.cost_price, markup: p.markup,
      sell_price: p.sell_price, device_type: p.device_type,
      is_default: p.is_default, is_active: p.is_active,
    })), [rawProducts]);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const selectedSite = selectedCustomer?.customer_sites.find((s) => s.id === siteId);

  // Customer/site search results
  const customerSearchResults = useMemo(() => {
    if (!customerSearch || customerSearch.length < 2) return [];
    const q = customerSearch.toLowerCase();
    const results: { customerId: string; customerName: string; siteId?: string; siteName?: string }[] = [];
    for (const customer of customers) {
      if (customer.name.toLowerCase().includes(q)) {
        results.push({ customerId: customer.id, customerName: customer.name });
      }
      for (const site of customer.customer_sites) {
        if (site.name.toLowerCase().includes(q)) {
          results.push({ customerId: customer.id, customerName: customer.name, siteId: site.id, siteName: site.name });
        }
      }
    }
    return results.slice(0, 15);
  }, [customers, customerSearch]);

  // Select a customer and populate details
  function selectCustomer(id: string) {
    setCustomerId(id);
    setSiteId("");
    const cust = customers.find((c) => c.id === id);
    if (cust) {
      setClientName(cust.name);
      // Auto-select first site if available
      if (cust.customer_sites.length > 0) {
        const site = cust.customer_sites[0];
        setSiteId(site.id);
        setSiteName(site.name);
        const addrParts = [site.address, site.suburb, site.state, site.postcode].filter(Boolean);
        setSiteAddress(addrParts.join(", "));
      }
    }
  }

  // Select a site within the chosen customer
  function selectSite(id: string) {
    setSiteId(id);
    const site = selectedCustomer?.customer_sites.find((s) => s.id === id);
    if (site) {
      setSiteName(site.name);
      const addrParts = [site.address, site.suburb, site.state, site.postcode].filter(Boolean);
      setSiteAddress(addrParts.join(", "));
    }
  }

  // Select a plan from the dropdown
  function selectPlan(planId: string) {
    setSelectedPlanId(planId);
    if (!planId) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;

    // Fill client details
    if (plan.client_name) setClientName(plan.client_name);
    if (plan.site_name) setSiteName(plan.site_name);
    if (plan.site_address) setSiteAddress(plan.site_address);

    // If plan has a linked customer, select them
    if (plan.customer_id) {
      selectCustomer(plan.customer_id);
    }

    // Fill site info + state
    setSiteInfo((prev) => ({
      ...prev,
      ...(plan.site_info ? {
        door_count: (plan.site_info.door_count as number) || prev.door_count,
        reed_switch_uncabled: (plan.site_info.reed_switch_uncabled as number) || 0,
      } : {}),
      state: plan.state || prev.state || 'QLD',
    }));

    // Fill device counts
    if (plan.device_counts && Object.keys(plan.device_counts).length > 0) {
      setDeviceCounts(plan.device_counts);
      setBomGenerated(false);
    }

    const totalDevices = Object.values(plan.device_counts || {}).reduce((a, b) => a + (b as number), 0);
    toast(`Loaded ${totalDevices} devices from plan`);
  }

  // Auto-select plan from URL params (sent from Plan Builder's "Complete Plan")
  useEffect(() => {
    const planParam = searchParams.get("plan");
    if (!planParam || selectedPlanId) return;
    const plan = plans.find((p) => p.id === planParam);
    if (plan) {
      selectPlan(planParam);
    } else {
      // Plan may already have a quote_id (re-quoting) — fetch it directly
      supabase.from("plan_files").select("*").eq("id", planParam).single().then(({ data }) => {
        if (data) {
          plans.push(data);
          selectPlan(planParam);
        }
      });
    }
  }, []);

  // Customer + site are sourced from the linked job — re-fetch whenever the
  // user changes the Link-to-Job dropdown (also fires once on mount when the
  // wizard loads with ?job=X or with an existingQuote.jobId).
  useEffect(() => {
    if (!linkedJobId) return;
    supabase
      .from("jobs")
      .select("id, customer_id, site_id, customer:customers!customer_id(id, name, customer_sites(id, name, address, suburb, state, postcode))")
      .eq("id", linkedJobId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const job = data as any;
        if (job.customer_id) {
          if (!customers.find((c) => c.id === job.customer_id) && job.customer) {
            customers.push({
              id: job.customer.id,
              name: job.customer.name,
              customer_sites: job.customer.customer_sites ?? [],
              customer_contacts: [],
            });
          }
          setCustomerId(job.customer_id);
          setClientName(job.customer?.name ?? "");
        }
        if (job.site_id) {
          const site = job.customer?.customer_sites?.find((s: any) => s.id === job.site_id);
          setSiteId(job.site_id);
          if (site) {
            setSiteName(site.name);
            const addr = [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(", ");
            setSiteAddress(addr);
            if (site.state) {
              setSiteInfo((prev) => ({ ...prev, state: site.state }));
            }
          }
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedJobId]);

  // ── Draft persistence (new quotes only) ──
  // Restore draft on mount
  useEffect(() => {
    if (isEditing || searchParams.get("plan")) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setShowDraftBanner(true);
    } catch {}
  }, []);

  function resumeDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.step != null) setStep(d.step);
      if (d.quoteMode) setQuoteMode(d.quoteMode);
      if (d.customerId) setCustomerId(d.customerId);
      if (d.siteId) setSiteId(d.siteId);
      if (d.clientName) setClientName(d.clientName);
      if (d.siteName) setSiteName(d.siteName);
      if (d.siteAddress) setSiteAddress(d.siteAddress);
      if (d.siteInfo) setSiteInfo(d.siteInfo);
      if (d.deviceCounts) setDeviceCounts(d.deviceCounts);
      if (d.bomItems) setBomItems(d.bomItems);
      if (d.labourData) setLabourData(d.labourData);
      if (d.extras) setExtras(d.extras);
      if (d.discountPercent != null) setDiscountPercent(d.discountPercent);
      if (d.quoteType) setQuoteType(d.quoteType);
      if (d.linkedJobId) setLinkedJobId(d.linkedJobId);
      if (d.selectedPlanId) setSelectedPlanId(d.selectedPlanId);
      if (d.manualScope) setManualScope(d.manualScope);
      if (d.manualBomItems) setManualBomItems(d.manualBomItems);
      if (d.manualLabourHours != null) setManualLabourHours(d.manualLabourHours);
      if (d.manualLabourAmount != null) setManualLabourAmount(d.manualLabourAmount);
      if (d.manualCalloutDays != null) setManualCalloutDays(d.manualCalloutDays);
      if (d.electricianCost != null) setElectricianCost(d.electricianCost);
      if (d.elecDoingRoughIn != null) setElecDoingRoughIn(d.elecDoingRoughIn);
      if (d.elecDoingFitOff != null) setElecDoingFitOff(d.elecDoingFitOff);
    } catch {}
    setShowDraftBanner(false);
  }

  function discardDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setShowDraftBanner(false);
  }

  // Save draft on meaningful state changes
  useEffect(() => {
    if (isEditing) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          step, quoteMode, customerId, siteId, clientName, siteName, siteAddress, siteInfo,
          deviceCounts, bomItems, labourData, extras, discountPercent, quoteType,
          linkedJobId, selectedPlanId, manualScope, manualBomItems,
          manualLabourHours, manualLabourAmount, manualCalloutDays, electricianCost,
          elecDoingRoughIn, elecDoingFitOff,
        }));
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [step, quoteMode, customerId, siteId, clientName, siteName, siteAddress, siteInfo,
    deviceCounts, bomItems, labourData, extras, discountPercent, quoteType,
    linkedJobId, selectedPlanId, manualScope, manualBomItems,
    manualLabourHours, manualLabourAmount, manualCalloutDays, electricianCost,
    elecDoingRoughIn, elecDoingFitOff]);

  // Warn on unload
  useEffect(() => {
    if (isEditing) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (step > 0) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isEditing, step]);

  // Upload .cfq file — saves to DB as a plan, then loads it
  async function handlePlanImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.source !== "centrefit-plan-builder") {
          toast("Not a valid Plan Builder export file", "error");
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();

        // Save to plan_files table
        const planName = [data.project?.client, data.project?.projectName, data.project?.revision]
          .filter(Boolean).join(" - ") || file.name.replace(/\.cfq$/, "");

        const { data: newPlan, error } = await supabase.from("plan_files").insert({
          name: planName,
          client_name: data.project?.client || null,
          site_name: data.project?.projectName || null,
          site_address: data.project?.worksAddress || null,
          state: data.project?.state || 'QLD',
          device_counts: data.deviceCounts || {},
          site_info: data.siteInfo || {},
          floor_data: data.floors || null,
          raw_data: data,
          uploaded_by: user?.id ?? null,
        }).select("id").single();

        if (error) {
          toast(error.message, "error");
          return;
        }

        // Now load it
        if (newPlan) setSelectedPlanId(newPlan.id);
        if (data.project?.client) setClientName(data.project.client);
        if (data.project?.projectName) setSiteName(data.project.projectName);
        if (data.project?.worksAddress) setSiteAddress(data.project.worksAddress);
        if (data.siteInfo?.door_count) setSI("door_count", data.siteInfo.door_count);
        if (data.deviceCounts) {
          setDeviceCounts(data.deviceCounts);
          setBomGenerated(false);
        }

        const totalDevices = Object.values(data.deviceCounts || {}).reduce((a: number, b) => a + (b as number), 0);
        toast(`Imported ${totalDevices} devices — plan saved`);
        setStep(1);
      } catch {
        toast("Failed to import plan data", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // Device counts derived from BOM — so labour reflects BOM edits
  // (deletions, additions, qty changes) rather than original Step 2 counts.
  const bomDeviceCounts = useMemo(() => {
    const counts: DeviceCounts = {};
    for (const item of bomItems) {
      if (item.device_type_code) {
        counts[item.device_type_code] =
          (counts[item.device_type_code] ?? 0) + item.quantity;
      }
    }
    return counts;
  }, [bomItems]);

  // Track formula-driven labour lines the user has explicitly deleted, so
  // regen doesn't resurrect them. Keyed as `${sectionName}::${itemName}`.
  // Persisted inside labour_data.deleted_labour_keys so deletions survive
  // across save/edit cycles — without this, every BOM change after re-opening
  // a saved quote was resurrecting items the user had previously deleted.
  const [deletedLabourKeys, setDeletedLabourKeys] = useState<Set<string>>(
    () => new Set<string>(
      Array.isArray((existingQuote?.labourData as any)?.deleted_labour_keys)
        ? (existingQuote!.labourData as any).deleted_labour_keys
        : []
    )
  );
  const labourKey = (sectionName: string, itemName: string) =>
    `${sectionName}::${itemName}`;

  // Derive labour-engine maps from the timings array prop
  const labourTimingOverrides = useMemo<Record<string, number>>(
    () => Object.fromEntries(labourTimings.map((t) => [t.code, t.minutes_per])),
    [labourTimings],
  );
  const labourTimingsMap = useMemo<Record<string, { code: string; name: string; minutes_per: number }>>(
    () => Object.fromEntries(labourTimings.map((t) => [t.code, t])),
    [labourTimings],
  );

  // Build BOM labour lines: aggregate quantity by labour_code (for Fit Off)
  // AND emit per-product cable-run flags (for Rough In). Both are passed to
  // calculateLabour so it can build the right labour breakdown from BOM
  // instead of the legacy device-counts mapping.
  const bomLabourLines = useMemo(() => {
    const productLookup = new Map(rawProducts.map((p) => [p.id, p]));
    const source = quoteMode === "manual" ? manualBomItems : bomItems;

    // 1. Aggregate by labour_code (Fit Off)
    const fitOffTotals = new Map<string, number>();
    for (const line of source) {
      if (!line.product_id) continue;
      const product = productLookup.get(line.product_id);
      const code = product?.labour_code;
      if (!code || code === 'none') continue;
      fitOffTotals.set(code, (fitOffTotals.get(code) ?? 0) + line.quantity);
    }
    const fitOffLines = Array.from(fitOffTotals.entries()).map(
      ([labour_code, quantity]) => ({ labour_code, quantity })
    );

    // 2. Per-line cable-run signals (Rough In) — separate entries with
    //    requires_cable=true and the product's quantity.
    const cableLines: { labour_code: null; quantity: number; requires_cable: true }[] = [];
    for (const line of source) {
      if (!line.product_id) continue;
      const product = productLookup.get(line.product_id);
      if (product?.requires_cable_run && line.quantity > 0) {
        cableLines.push({ labour_code: null, quantity: line.quantity, requires_cable: true });
      }
    }

    return [...fitOffLines, ...cableLines];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomItems, manualBomItems, quoteMode, rawProducts]);

  function regenerateLabour() {
    const source = bomGenerated ? bomDeviceCounts : deviceCounts;
    const fresh = calculateLabour(source, siteInfo, billingSettings ? {
      labourCostRate: billingSettings.labour_cost_rate,
      labourSellRate: billingSettings.labour_sell_rate,
    } : {}, labourTimingOverrides, { elecDoingRoughIn, elecDoingFitOff }, bomLabourLines, labourTimingsMap);

    if (!labourData) {
      setLabourData(fresh);
      return;
    }

    // Merge with existing labourData:
    // - Drop fresh items the user has deleted (tracked in deletedLabourKeys)
    // - Formula items with hour overrides: preserve the override
    // - Custom items (isCustom): preserved entirely
    const merged = {
      ...fresh,
      sections: fresh.sections.map((section) => {
        const oldSection = labourData.sections.find((s) => s.name === section.name);
        if (!oldSection) {
          return {
            ...section,
            items: section.items.filter(
              (it) => !deletedLabourKeys.has(labourKey(section.name, it.name))
            ),
          };
        }

        const mergedFormulaItems = section.items
          .filter(
            (it) => !deletedLabourKeys.has(labourKey(section.name, it.name))
          )
          .map((newItem) => {
            const oldItem = oldSection.items.find(
              (it) => it.name === newItem.name && !it.isCustom
            );
            if (!oldItem) return newItem;
            const userOverrode =
              Math.abs(oldItem.hours - oldItem.defaultHours) > 0.001;
            return userOverrode ? { ...newItem, hours: oldItem.hours } : newItem;
          });

        const customItems = oldSection.items.filter((it) => it.isCustom);
        return { ...section, items: [...mergedFormulaItems, ...customItems] };
      }),
    };
    setLabourData(recalcLabour(merged));
  }

  // Auto-recompute labour whenever the BOM changes (after initial generation).
  // regenerateLabour() preserves both:
  //   - user-added custom labour lines (isCustom flag)
  //   - manual hour overrides on formula lines (hours != defaultHours)
  // so BOM edits update the formula values without wiping the user's tweaks.
  const labourFirstSync = useRef(true);
  useEffect(() => {
    if (labourFirstSync.current) {
      labourFirstSync.current = false;
      return;
    }
    if (!labourData) return;
    if (quoteMode === "plan" && !bomGenerated) return;
    regenerateLabour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomItems, manualBomItems]);

  function enterStep(newStep: number) {
    if (quoteMode === "plan") {
      if (newStep === 2 && !bomGenerated) {
        const rules = rulesForTemplate(allRules, templateId, products);
        setBomItems(generateBOM(deviceCounts, products, rules, siteInfo));
        setBomGenerated(true);
      }
      if (newStep === 3 && !labourData) {
        regenerateLabour();
      }
      // Regenerate labour before summary in case elec toggles changed on extras step
      if (newStep === 5) {
        regenerateLabour();
      }
    } else if (quoteMode === "manual") {
      // Manual mode now uses the same labour engine — generate a starter
      // breakdown from BOM × labour_code when entering the Labour step.
      if (newStep === 3 && !labourData) {
        regenerateLabour();
      }
      if (newStep === 5) {
        regenerateLabour();
      }
    }
    setStep(newStep);
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function regenerateBOM() {
    const rules = rulesForTemplate(allRules, templateId, products);
    setBomItems(generateBOM(deviceCounts, products, rules, siteInfo));
    setBomGenerated(true);
  }

  const bomTotals = useMemo(() => calculateBOMTotals(bomItems), [bomItems]);

  // Manual BOM totals
  const manualBomTotals = useMemo(() => {
    let totalCost = 0, totalSell = 0;
    for (const item of manualBomItems) {
      totalCost += item.cost_price * item.quantity;
      totalSell += item.sell_price * item.quantity;
    }
    return { totalCost, totalSell, totalProfit: totalSell - totalCost, itemCount: manualBomItems.reduce((s, i) => s + i.quantity, 0) };
  }, [manualBomItems]);

  // Manual labour data builder
  const costRate = billingSettings?.labour_cost_rate ?? 85;
  const sellRate = billingSettings?.labour_sell_rate ?? 150;

  const calloutTotal = manualCalloutDays * 80;
  const manualLabourData: LabourData = useMemo(() => ({
    sections: [{
      name: "Labour",
      mandatory: false,
      warning: null,
      items: [
        { name: "Labour", formula: `${manualLabourHours} hrs × $${sellRate}`, defaultHours: manualLabourHours, hours: manualLabourHours },
        { name: "Callout", formula: `${manualCalloutDays} days × $80`, defaultHours: manualCalloutDays, hours: manualCalloutDays, unitRate: 80, unitLabel: "days" },
      ],
      totalHours: manualLabourHours,
      totalCost: manualLabourHours * costRate + calloutTotal,
      totalSell: manualLabourHours * sellRate + calloutTotal,
    }],
    fixedCosts: [],
    grandTotalHours: manualLabourHours,
    grandTotalCost: manualLabourHours * costRate + manualLabourAmount + calloutTotal,
    grandTotalSell: manualLabourHours * sellRate + manualLabourAmount + calloutTotal,
    costRate,
    sellRate,
  }), [manualLabourHours, manualLabourAmount, manualCalloutDays, calloutTotal, costRate, sellRate]);

  // Manual BOM items converted to BOMItem format for summary calculation
  const manualBomAsBomItems: BOMItem[] = useMemo(() =>
    manualBomItems.map((item) => ({
      device_type_code: null,
      device_type_legend: null,
      category: item.category || "Manual",
      product_id: item.product_id,
      product_name: item.product_name,
      sku: item.sku,
      supplier: item.supplier,
      quantity: item.quantity,
      cost_price: item.cost_price,
      markup: item.sell_price > 0 && item.cost_price > 0 ? (item.sell_price / item.cost_price) - 1 : 0,
      sell_price: item.sell_price,
      notes: "",
      auto_added: false,
      rule_description: null,
    })), [manualBomItems]);

  // Product search for manual BOM
  const manualBomSearchResults = useMemo(() => {
    if (!manualBomSearch || manualBomSearch.length < 2) return [];
    const q = manualBomSearch.toLowerCase();
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [products, manualBomSearch]);

  const summary: QuoteSummary | null = useMemo(() => {
    if (quoteMode === "manual") {
      // Manual mode now uses real labourData when available (computed from BOM
      // × labour_code on entering the Labour step). Falls back to the legacy
      // manualLabourData for old quotes that haven't entered the Labour step
      // since the unification.
      const effective = labourData ?? manualLabourData;
      return calculateQuoteSummary(manualBomAsBomItems, effective, extras, { discountPercent, electricianCost, isInterstate });
    }
    if (!labourData) return null;
    return calculateQuoteSummary(bomItems, labourData, extras, { discountPercent, electricianCost, isInterstate });
  }, [quoteMode, bomItems, labourData, extras, discountPercent, electricianCost, isInterstate, manualBomAsBomItems, manualLabourData]);

  const labourWarnings = useMemo(() => {
    if (quoteMode === "manual") return [];
    return labourData ? checkMandatoryLabour(labourData) : [];
  }, [quoteMode, labourData]);

  function setSI(field: keyof SiteInfo, value: number | boolean) {
    setSiteInfo((prev) => ({ ...prev, [field]: value }));
  }

  function setDC(code: string, value: number) {
    setDeviceCounts((prev) => ({ ...prev, [code]: Math.max(0, value) }));
    setBomGenerated(false);
  }

  function updateLabourHours(si: number, ii: number, hours: number) {
    if (!labourData) return;
    const updated = {
      ...labourData,
      sections: labourData.sections.map((s, idx) =>
        idx !== si ? s : {
          ...s,
          items: s.items.map((item, jdx) =>
            jdx !== ii ? item : { ...item, hours: Math.max(0, hours) }
          ),
        }
      ),
    };
    setLabourData(recalcLabour(updated));
  }

  function updateLabourName(si: number, ii: number, name: string) {
    if (!labourData) return;
    setLabourData({
      ...labourData,
      sections: labourData.sections.map((s, idx) =>
        idx !== si ? s : {
          ...s,
          items: s.items.map((item, jdx) =>
            jdx !== ii ? item : { ...item, name }
          ),
        }
      ),
    });
  }

  function addLabourLine(si: number) {
    if (!labourData) return;
    const newItem = {
      name: "",
      formula: "Manual",
      defaultHours: 0,
      hours: 0,
      isCustom: true,
    };
    const updated = {
      ...labourData,
      sections: labourData.sections.map((s, idx) =>
        idx !== si ? s : { ...s, items: [...s.items, newItem] }
      ),
    };
    setLabourData(recalcLabour(updated));
  }

  function deleteLabourLine(si: number, ii: number) {
    if (!labourData) return;
    const section = labourData.sections[si];
    const item = section?.items[ii];
    if (!item) return;

    // For formula-driven items, remember the deletion so regen doesn't resurrect it.
    if (!item.isCustom) {
      setDeletedLabourKeys((prev) => {
        const next = new Set(prev);
        next.add(labourKey(section.name, item.name));
        return next;
      });
    }

    const updated = {
      ...labourData,
      sections: labourData.sections.map((s, idx) =>
        idx !== si ? s : { ...s, items: s.items.filter((_, jdx) => jdx !== ii) }
      ),
    };
    setLabourData(recalcLabour(updated));
  }

  async function handleSave() {
    // Both modes now write the real labourData to quote.labour_data.
    // Manual quotes that haven't visited the Labour step still get their
    // legacy manualLabourData saved as a fallback.
    const effectiveLabourData = labourData ?? (quoteMode === "manual" ? manualLabourData : null);
    if (!summary || !effectiveLabourData) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    const quotePayload = {
      customer_id: customerId || null,
      site_id: siteId || null,
      client_name: selectedCustomer?.name || clientName,
      site_name: siteName,
      site_address: siteAddress || null,
      site_sqm: siteInfo.site_sqm || null,
      door_count: siteInfo.door_count || 0,
      external_camera_count: siteInfo.external_camera_count || 0,
      concrete_mount_black: siteInfo.concrete_mount_black || 0,
      concrete_mount_white: siteInfo.concrete_mount_white || 0,
      cardio_count: siteInfo.cardio_count || 0,
      tv_count: siteInfo.tv_count || 0,
      ceiling_tv_count: siteInfo.ceiling_tv_count || 0,
      wall_tv_mount_count: siteInfo.wall_tv_mount_count || 0,
      ceiling_tv_mount_count: siteInfo.ceiling_tv_mount_count || 0,
      separate_studio_zone: siteInfo.separate_studio_zone || false,
      device_counts: deviceCounts,
      labour_data: {
        ...effectiveLabourData,
        // Persist the user's labour-line deletions so regen doesn't
        // resurrect them next time the quote is edited.
        deleted_labour_keys: Array.from(deletedLabourKeys),
        ...(quoteMode === "manual" ? { scope_of_works: manualScope, quote_mode: "manual" } : { quote_mode: "plan" }),
      },
      discount_percent: discountPercent,
      electrician_cost: electricianCost || 0,
      elec_doing_rough_in: elecDoingRoughIn,
      elec_doing_fit_off: elecDoingFitOff,
      quote_type: quoteType,
      template_id: quoteMode === "manual" ? null : templateId,
      pricing_snapshot: {
        ...summary,
        ...(quoteMode === "manual" ? { scope_of_works: manualScope, quote_mode: "manual" } : { quote_mode: "plan" }),
      },
      expires_at: new Date(Date.now() + (billingSettings?.quote_validity_days ?? 30) * 86400000).toISOString(),
    };

    let quoteId: string;

    if (isEditing && existingQuote) {
      // UPDATE existing quote
      const { error } = await supabase.from("quotes").update(quotePayload).eq("id", existingQuote.quoteId);
      if (error) {
        toast(error.message, "error");
        setSaving(false);
        return;
      }
      quoteId = existingQuote.quoteId;

      // Replace line items and extras
      await supabase.from("quote_line_items").delete().eq("quote_id", quoteId);
      await supabase.from("quote_extras").delete().eq("quote_id", quoteId);
    } else {
      // INSERT new quote. Ref is CF-{year}-{NNNN} where NNNN is the next
      // number for the current year. We look up MAX(NNNN) for this year's
      // existing refs rather than using count(*), which was broken (not
      // year-scoped, and susceptible to deletes/concurrency).
      //
      // A UNIQUE constraint on quotes.ref catches any race collision — if
      // two users save at once, one gets 23505 and we retry with +1. We
      // cap retries at 5 to avoid infinite loops.
      const year = new Date().getFullYear();
      const refPrefix = `CF-${year}-`;

      const { data: yearQuotes, error: refErr } = await supabase
        .from("quotes")
        .select("ref")
        .like("ref", `${refPrefix}%`);
      if (refErr) {
        toast(refErr.message, "error");
        setSaving(false);
        return;
      }
      let nextNumber = 1;
      for (const q of yearQuotes ?? []) {
        const match = /-(\d+)$/.exec(q.ref ?? "");
        if (match) {
          const n = parseInt(match[1], 10);
          if (!Number.isNaN(n) && n >= nextNumber) nextNumber = n + 1;
        }
      }

      let newQuoteId: string | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `${refPrefix}${String(nextNumber).padStart(4, "0")}`;
        const { data: newQuote, error } = await supabase
          .from("quotes")
          .insert({
            ...quotePayload,
            ref: candidate,
            status: "draft",
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();

        if (!error && newQuote) {
          newQuoteId = newQuote.id;
          break;
        }

        // 23505 = unique_violation — someone else grabbed this ref. Try next.
        const isUniqueViolation =
          error?.code === "23505" ||
          (error?.message ?? "").toLowerCase().includes("duplicate key");
        if (!isUniqueViolation) {
          toast(error?.message || "Failed to save", "error");
          setSaving(false);
          return;
        }
        nextNumber += 1;
      }

      if (!newQuoteId) {
        toast("Could not allocate a unique quote ref after 5 attempts", "error");
        setSaving(false);
        return;
      }
      quoteId = newQuoteId;
    }

    const lineItemsToSave = quoteMode === "manual" ? manualBomAsBomItems : bomItems;
    if (lineItemsToSave.length > 0) {
      await supabase.from("quote_line_items").insert(
        lineItemsToSave.map((item, i) => ({
          quote_id: quoteId, product_id: item.product_id,
          device_type_code: item.device_type_code, device_type_legend: item.device_type_legend,
          category: item.category, product_name: item.product_name,
          sku: item.sku, supplier: item.supplier, quantity: item.quantity,
          cost_price: item.cost_price, markup: item.markup, sell_price: item.sell_price,
          auto_added: item.auto_added, rule_description: item.rule_description,
          notes: item.notes, sort_order: i,
        }))
      );
    }

    const activeExtras = extras.filter((e) => e.cost > 0 || e.sell > 0);
    if (activeExtras.length > 0) {
      await supabase.from("quote_extras").insert(
        activeExtras.map((e, i) => ({
          quote_id: quoteId, category: e.category,
          description: e.description, cost: e.cost, sell: e.sell, sort_order: i,
        }))
      );
    }

    // Link the plan to this quote
    if (selectedPlanId) {
      await supabase.from("plan_files").update({ quote_id: quoteId }).eq("id", selectedPlanId);
    }

    // Link to job and auto-transition status
    if (linkedJobId && !isEditing) {
      console.log(`[Auto-transition] Linking quote ${quoteId} to job ${linkedJobId}`);
      const { error: linkError } = await supabase.from("quotes").update({ job_id: linkedJobId }).eq("id", quoteId);
      if (linkError) console.error('[Auto-transition] Link error:', linkError);
      const result = await autoTransitionJobStatus(linkedJobId, "quote_created", supabase);
      console.log('[Auto-transition] Result:', result);
    }

    // Clear draft on successful save
    if (!isEditing) {
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
    }

    toast(isEditing ? "Quote updated" : "Quote saved");
    router.push(isEditing ? `/quoting/${quoteId}` : "/quoting");
    router.refresh();
  }

  const devicesByCategory = useMemo(() => {
    const map = new Map<string, typeof DEVICE_TYPES>();
    for (const dt of DEVICE_TYPES) {
      const list = map.get(dt.category) ?? [];
      list.push(dt);
      map.set(dt.category, list);
    }
    return map;
  }, []);

  const bomByCategory = useMemo(() => {
    const map = new Map<string, BOMItem[]>();
    for (const item of bomItems) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [bomItems]);

  // BOM per-category add/delete state
  const [bomAddCategory, setBomAddCategory] = useState<string | null>(null);
  const [bomAddSearch, setBomAddSearch] = useState("");

  const bomAddResults = useMemo(() => {
    if (!bomAddCategory) return [];
    const q = bomAddSearch.trim().toLowerCase();
    const pool = products.filter((p) => p.is_active);
    const sameCat = pool.filter((p) => p.category.toLowerCase() === bomAddCategory.toLowerCase());
    const base = sameCat.length > 0 ? sameCat : pool;
    if (!q) return base.slice(0, 20);
    return base
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.supplier.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [bomAddCategory, bomAddSearch, products]);

  function addProductToBom(product: Product, category: string) {
    setBomItems((prev) => {
      const existing = prev.find(
        (b) => b.product_id === product.id && b.category === category
      );
      if (existing) {
        return prev.map((b) =>
          b === existing ? { ...b, quantity: b.quantity + 1 } : b
        );
      }
      const newItem: BOMItem = {
        device_type_code: null,
        device_type_legend: null,
        category,
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        supplier: product.supplier,
        quantity: 1,
        cost_price: product.cost_price,
        markup: product.markup,
        sell_price: product.sell_price,
        notes: "",
        auto_added: false,
        rule_description: null,
      };
      return [...prev, newItem];
    });
    setBomAddSearch("");
    setBomAddCategory(null);
  }

  function addCustomToBom(category: string) {
    const newItem: BOMItem = {
      device_type_code: null,
      device_type_legend: null,
      category,
      product_id: null,
      product_name: "",
      sku: "",
      supplier: "",
      quantity: 1,
      cost_price: 0,
      markup: 0,
      sell_price: 0,
      notes: "",
      auto_added: false,
      rule_description: null,
    };
    setBomItems((prev) => [...prev, newItem]);
    setBomAddCategory(null);
    setBomAddSearch("");
  }

  function deleteBomItem(target: BOMItem) {
    setBomItems((prev) => prev.filter((b) => b !== target));
  }

  function patchBomItem(target: BOMItem, patch: Partial<BOMItem>) {
    setBomItems((prev) => prev.map((b) => (b === target ? { ...b, ...patch } : b)));
  }

  return (
    <div>
      {/* Draft resume banner */}
      {showDraftBanner && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-sm">You have an unsaved draft. Resume where you left off?</p>
          <div className="flex gap-2">
            <button onClick={resumeDraft} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Resume</button>
            <button onClick={discardDraft} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Discard</button>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex gap-1 mb-6">
        {STEPS.map((name, i) => (
          <button key={name} onClick={() => enterStep(i)} className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
            {i + 1}. {name}
          </button>
        ))}
      </div>

      {/* STEP 1: CLIENT */}
      {step === 0 && (
        <div className="space-y-4 max-w-2xl">
          {/* Link to Job — mandatory. Customer + site are derived from the job. */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Link to Job <span className="text-destructive">*</span>
            </label>
            <select value={linkedJobId} onChange={(e) => setLinkedJobId(e.target.value)} className={inputClass}>
              <option value="">Select a job...</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number}{j.site_name ? ` — ${j.site_name}` : ''}{j.customer_name ? ` (${j.customer_name})` : ''}
                </option>
              ))}
            </select>
            {!linkedJobId && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Quotes must be attached to a job. Customer and site details come from the job — to change them, edit the job's customer or site directly.
              </p>
            )}
          </div>

          {/* Quote Mode Toggle */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Quote Mode</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setQuoteMode("plan")}
                className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${quoteMode === "plan" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
              >
                <p className="text-sm font-medium">Plan-Based Quote</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Auto-generate BOM and labour from device counts</p>
              </button>
              <button
                type="button"
                onClick={() => setQuoteMode("manual")}
                className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${quoteMode === "manual" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
              >
                <p className="text-sm font-medium">Manual Quote</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Manually select products and set labour hours</p>
              </button>
            </div>
          </div>

          {/* Quote Type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Quote Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setQuoteType("full")}
                className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${quoteType === "full" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
              >
                <p className="text-sm font-medium">Full Quote</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Single payment — total price invoiced at once</p>
              </button>
              <button
                type="button"
                onClick={() => setQuoteType("progress")}
                className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${quoteType === "progress" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
              >
                <p className="text-sm font-medium">Progress Payments</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">PP1 on acceptance, PP2 on completion</p>
              </button>
            </div>
          </div>

          {/* Template selection — applies the chosen ruleset to this quote's BOM. Plan mode only. */}
          {quoteMode === "plan" && templates.length > 0 && (() => {
            const activeTpl = templates.find((t) => t.id === templateId);
            const ruleCount = templateId
              ? allRules.filter((r) => r.template_id === templateId && r.is_active).length
              : 0;
            return (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Rule template
                  <span className="ml-1 text-muted-foreground/60">— which ruleset builds the BOM for this quote</span>
                </label>
                <select
                  value={templateId ?? ""}
                  onChange={(e) => {
                    const newId = e.target.value || null;
                    if (bomGenerated && newId !== templateId) {
                      if (!confirm("Changing the template will regenerate the BOM next time you enter the BOM step. Custom edits to BOM lines may be lost. Continue?")) return;
                      setBomGenerated(false);
                      setBomItems([]);
                    }
                    setTemplateId(newId);
                  }}
                  className={inputClass}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}{tpl.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                {activeTpl && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {activeTpl.description ? `${activeTpl.description} · ` : ""}
                    <span className="font-mono tabular-nums">{ruleCount}</span> active rule{ruleCount === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            );
          })()}

          {/* Plan Selection — plan mode only */}
          {quoteMode === "plan" && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Start From</label>
            {plans.length > 0 ? (
              <div className="flex gap-2">
                <select value={selectedPlanId} onChange={(e) => selectPlan(e.target.value)} className={`${inputClass} flex-1`}>
                  <option value="">Standalone quote (no plan)</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {new Date(p.created_at).toLocaleDateString("en-AU")}
                    </option>
                  ))}
                </select>
                <input ref={planImportRef} type="file" accept=".cfq,.json" className="hidden" onChange={handlePlanImport} />
                <button
                  onClick={() => planImportRef.current?.click()}
                  className="shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  Upload .cfq
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                  No plans available — standalone quote
                </div>
                <input ref={planImportRef} type="file" accept=".cfq,.json" className="hidden" onChange={handlePlanImport} />
                <button
                  onClick={() => planImportRef.current?.click()}
                  className="shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  Upload .cfq
                </button>
              </div>
            )}
          </div>
          )}

          <h3 className="text-sm font-semibold mt-6">Site Info</h3>
          <p className="text-xs text-muted-foreground -mt-2">Used by dependency rules for ancillary products.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {([["site_sqm","Site Area (sqm)"],["door_count","Door Count"],["external_camera_count","External Cameras"],["concrete_mount_black","Concrete Mounts (Black)"],["concrete_mount_white","Concrete Mounts (White)"],["cardio_count","Cardio Machines"],["tv_count","Wall TVs"],["ceiling_tv_count","Ceiling TVs"],["wall_tv_mount_count","Wall TV Mounts"],["ceiling_tv_mount_count","Ceiling TV Mounts"]] as [keyof SiteInfo, string][]).map(([field, label]) => (
              <div key={field}>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
                <input type="number" min="0" value={(siteInfo[field] as number) || ""} onChange={(e) => setSI(field, parseInt(e.target.value) || 0)} className={inputClass} />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm mt-2">
            <button type="button" onClick={() => setSI("separate_studio_zone", !siteInfo.separate_studio_zone)} className={`relative h-5 w-9 rounded-full transition-colors ${siteInfo.separate_studio_zone ? "bg-primary" : "bg-muted"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${siteInfo.separate_studio_zone ? "left-[18px]" : "left-0.5"}`} />
            </button>
            Separate Studio Zone
          </label>
        </div>
      )}

      {/* STEP 2: DEVICES */}
      {step === 1 && (
        <div className="space-y-6 max-w-3xl">
          {quoteMode === "manual" ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="text-sm text-primary">Rules don't apply to manual quotes — click Next to continue.</p>
            </div>
          ) : (() => {
            const universalRules = allRules.filter((r) => r.is_universal && r.is_active && r.auto_add_product_id);
            const templateRules = allRules.filter((r) => !r.is_universal && r.template_id === templateId && r.is_active && r.auto_add_product_id);
            const activeTpl = templates.find((t) => t.id === templateId);
            return (
              <>
                {/* Active template card */}
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Active template</p>
                      <h3 className="text-base font-semibold mt-1">{activeTpl?.name ?? "(none selected)"}</h3>
                      {activeTpl?.description && (
                        <p className="text-xs text-muted-foreground mt-1">{activeTpl.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Will fire</p>
                      <p className="text-2xl font-bold font-mono mt-1">{universalRules.length + templateRules.length}</p>
                      <p className="text-[11px] text-muted-foreground">{universalRules.length} universal · {templateRules.length} template</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    These rules fire when generating the BOM. Change the template on the previous step, or <a href="/settings/rules" target="_blank" rel="noopener" className="text-primary hover:underline">manage rules in Settings</a>.
                  </p>
                </div>

                {/* Universal Rules */}
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold">Universal rules</h3>
                      <span className="text-xs text-muted-foreground">— fire on every quote regardless of template</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{universalRules.length}</span>
                  </div>
                  {universalRules.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border bg-card/30 px-4 py-3 text-xs text-muted-foreground">
                      No universal rules yet. Promote a rule to universal in <a href="/settings/rules" target="_blank" rel="noopener" className="text-primary hover:underline">Settings → Rules</a> to fire it on every quote.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-card divide-y divide-border">
                      {universalRules.map((r) => {
                        const product = rawProducts.find((p) => p.id === r.auto_add_product_id);
                        return (
                          <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{r.description}</p>
                              {product && (
                                <p className="text-[11px] text-muted-foreground font-mono truncate">→ {product.name} <span className="opacity-60">({product.sku})</span></p>
                              )}
                            </div>
                            <span className="shrink-0 rounded bg-amber-500/10 text-amber-400 px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold border border-amber-500/20">universal</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Template Rules */}
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold">{activeTpl?.name ?? "Template"} rules</h3>
                      <span className="text-xs text-muted-foreground">— only fire on {activeTpl?.name ?? "this template"} quotes</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{templateRules.length}</span>
                  </div>
                  {templateRules.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border bg-card/30 px-4 py-3 text-xs text-muted-foreground">
                      {activeTpl?.slug === "default"
                        ? <>This is the empty <strong>Default</strong> template — only universal rules apply.</>
                        : <>No rules in this template yet. Add them in <a href="/settings/rules" target="_blank" rel="noopener" className="text-primary hover:underline">Settings → Rules</a>.</>}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-card divide-y divide-border">
                      {templateRules.map((r) => {
                        const product = rawProducts.find((p) => p.id === r.auto_add_product_id);
                        return (
                          <div key={r.id} className="px-4 py-2.5">
                            <p className="text-sm font-medium">{r.description}</p>
                            {product && (
                              <p className="text-[11px] text-muted-foreground font-mono">→ {product.name} <span className="opacity-60">({product.sku})</span></p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* STEP 3: BOM */}
      {step === 2 && (
        <div>
          {quoteMode === "manual" ? (
            <>
              {/* Manual BOM — Product search */}
              <div className="relative mb-4">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Search Products</label>
                <input
                  type="text"
                  value={manualBomSearch}
                  onChange={(e) => setManualBomSearch(e.target.value)}
                  placeholder="Search by product name or SKU..."
                  className={inputClass}
                />
                {manualBomSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                    {manualBomSearchResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setManualBomItems((prev) => {
                            const existing = prev.find((b) => b.product_id === p.id);
                            if (existing) return prev.map((b) => b.product_id === p.id ? { ...b, quantity: b.quantity + 1 } : b);
                            return [...prev, { product_id: p.id, product_name: p.name, sku: p.sku, category: p.category, supplier: p.supplier, quantity: 1, cost_price: p.cost_price, sell_price: p.sell_price, isCustom: false }];
                          });
                          setManualBomSearch("");
                        }}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors border-b border-border last:border-0"
                      >
                        <div>
                          <span className="font-medium">{p.name}</span>
                          <span className="ml-2 text-[11px] text-muted-foreground font-mono">{p.sku}</span>
                          <span className="block text-[11px] text-muted-foreground">{p.category} · {p.supplier}</span>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">${fmt(p.sell_price)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Custom Item button */}
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => setManualBomItems((prev) => [...prev, { product_id: null, product_name: "", sku: "", category: "", supplier: "", quantity: 1, cost_price: 0, sell_price: 0, isCustom: true }])}
                  className="rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  + Add Custom Item
                </button>
              </div>

              {/* Manual BOM totals */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Cost</p>
                  <p className="text-lg font-bold font-mono mt-1">${fmt(manualBomTotals.totalCost)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Sell</p>
                  <p className="text-lg font-bold font-mono mt-1">${fmt(manualBomTotals.totalSell)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">Profit</p>
                  <p className="text-lg font-bold font-mono text-emerald-400 mt-1">${fmt(manualBomTotals.totalProfit)}</p>
                </div>
              </div>

              {/* Manual BOM table */}
              {manualBomItems.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="grid grid-cols-[1fr_70px_90px_90px_100px_40px] gap-2 bg-muted/50 px-4 py-2.5 border-b border-border">
                    <span className="text-xs font-medium text-muted-foreground">Product</span>
                    <span className="text-xs font-medium text-muted-foreground text-center">Qty</span>
                    <span className="text-xs font-medium text-muted-foreground text-center">Cost</span>
                    <span className="text-xs font-medium text-muted-foreground text-center">Sell</span>
                    <span className="text-xs font-medium text-muted-foreground text-right">Total</span>
                    <span></span>
                  </div>
                  <div className="divide-y divide-border">
                    {manualBomItems.map((item, i) => (
                      <div key={i} className="grid grid-cols-[1fr_70px_90px_90px_100px_40px] gap-2 items-center px-4 py-2.5">
                        <div className="min-w-0">
                          {item.isCustom ? (
                            <input
                              type="text"
                              value={item.product_name}
                              onChange={(e) => setManualBomItems((prev) => prev.map((b, bi) => bi === i ? { ...b, product_name: e.target.value } : b))}
                              placeholder="Custom item name"
                              className={`${inputClass} text-sm`}
                            />
                          ) : (
                            <div className="flex items-start gap-2">
                              {(() => {
                                const product = rawProducts.find((p) => p.id === item.product_id);
                                return product?.image_url ? (
                                  <img src={product.image_url} alt="" className="h-9 w-9 rounded border border-border object-contain bg-card shrink-0" />
                                ) : null;
                              })()}
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{item.product_name}</p>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-[11px] text-muted-foreground font-mono truncate">{item.sku}</p>
                                  {(() => {
                                    const product = rawProducts.find((p) => p.id === item.product_id);
                                    if (!product) return null;
                                    return (
                                      <>
                                        {product.scope_role ? (
                                          <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400" title="Scope role — drives SoW placement">{product.scope_role}</span>
                                        ) : (
                                          <a href={`/settings/products`} target="_blank" rel="noopener" className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors" title="Missing scope role — click to tag">⚠ no scope</a>
                                        )}
                                        {product.labour_code ? (
                                          <span className="rounded bg-blue-500/10 px-1 py-0.5 text-[9px] font-medium text-blue-400" title="Labour code — drives labour calculation">{product.labour_code}</span>
                                        ) : (
                                          <a href={`/settings/products`} target="_blank" rel="noopener" className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors" title="Missing labour code — click to tag">⚠ no labour</a>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => setManualBomItems((prev) => prev.map((b, bi) => bi === i ? { ...b, quantity: parseInt(e.target.value) || 1 } : b))}
                          className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.cost_price || ""}
                          onChange={(e) => setManualBomItems((prev) => prev.map((b, bi) => bi === i ? { ...b, cost_price: parseFloat(e.target.value) || 0 } : b))}
                          placeholder="$0"
                          className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.sell_price || ""}
                          onChange={(e) => setManualBomItems((prev) => prev.map((b, bi) => bi === i ? { ...b, sell_price: parseFloat(e.target.value) || 0 } : b))}
                          placeholder="$0"
                          className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <p className="text-sm font-mono font-medium text-right">${fmt(item.sell_price * item.quantity)}</p>
                        <button
                          type="button"
                          onClick={() => setManualBomItems((prev) => prev.filter((_, bi) => bi !== i))}
                          className="text-muted-foreground hover:text-red-400 transition-colors text-center"
                          title="Remove"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Totals row */}
                  <div className="grid grid-cols-[1fr_70px_90px_90px_100px_40px] gap-2 items-center px-4 py-2.5 bg-muted/30 border-t border-border">
                    <span className="text-xs font-medium text-muted-foreground">Total ({manualBomItems.length} items)</span>
                    <span className="text-xs font-mono text-center">{manualBomTotals.itemCount}</span>
                    <span className="text-xs font-mono text-center">${fmt(manualBomTotals.totalCost)}</span>
                    <span className="text-xs font-mono text-center">${fmt(manualBomTotals.totalSell)}</span>
                    <span className="text-sm font-mono font-medium text-right">${fmt(manualBomTotals.totalSell)}</span>
                    <span></span>
                  </div>
                </div>
              )}

              {manualBomItems.length === 0 && (
                <div className="rounded-lg border border-dashed border-border bg-card/50 px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No items added yet. Search for products above or add a custom item.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">{bomItems.length} line items · {bomTotals.itemCount} total units</p>
                </div>
                <button onClick={regenerateBOM} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Regenerate BOM</button>
              </div>

              {/* BOM totals card at top */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Cost</p>
                  <p className="text-lg font-bold font-mono mt-1">${fmt(bomTotals.totalCost)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Sell</p>
                  <p className="text-lg font-bold font-mono mt-1">${fmt(bomTotals.totalSell)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">Profit</p>
                  <p className="text-lg font-bold font-mono text-emerald-400 mt-1">${fmt(bomTotals.totalProfit)}</p>
                </div>
              </div>

              {/* Category sections */}
              {Array.from(bomByCategory).map(([category, items]) => {
                const catCost = items.reduce((s, i) => s + i.cost_price * i.quantity, 0);
                const catSell = items.reduce((s, i) => s + i.sell_price * i.quantity, 0);
                const isAdding = bomAddCategory === category;
                return (
                  <div key={category} className="mb-5 rounded-lg border border-border overflow-hidden">
                    {/* Category header */}
                    <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5 border-b border-border">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</h3>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{items.length}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setBomAddCategory(isAdding ? null : category);
                            setBomAddSearch("");
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          {isAdding ? "Cancel" : "+ Product"}
                        </button>
                        <button
                          type="button"
                          onClick={() => addCustomToBom(category)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          + Custom
                        </button>
                        <span className="ml-2 text-xs font-mono text-muted-foreground">${fmt(catSell)}</span>
                      </div>
                    </div>

                    {/* Inline product search (open when + Product clicked) */}
                    {isAdding && (
                      <div className="border-b border-border bg-card/50 p-3">
                        <input
                          type="text"
                          autoFocus
                          value={bomAddSearch}
                          onChange={(e) => setBomAddSearch(e.target.value)}
                          placeholder={`Search products in ${category}...`}
                          className={inputClass}
                        />
                        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-card">
                          {bomAddResults.length === 0 ? (
                            <p className="px-3 py-3 text-xs text-muted-foreground">
                              No matching products.
                            </p>
                          ) : (
                            bomAddResults.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => addProductToBom(p, category)}
                                className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-accent transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium">{p.name}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    <span className="font-mono">{p.sku}</span>
                                    {p.supplier && <> · {p.supplier}</>}
                                    {p.category.toLowerCase() !== category.toLowerCase() && (
                                      <span className="ml-1 rounded bg-amber-500/10 px-1 text-[10px] text-amber-400">
                                        {p.category}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <span className="shrink-0 font-mono text-xs">${fmt(p.sell_price)}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Items */}
                    <div className="divide-y divide-border">
                      {items.map((item, i) => {
                        const isCustom = item.product_id === null;
                        return (
                          <div key={`${item.product_id ?? "custom"}-${i}`} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-4">
                              {/* Product info */}
                              <div className="flex-1 min-w-0">
                                {isCustom ? (
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      value={item.product_name}
                                      onChange={(e) => patchBomItem(item, { product_name: e.target.value })}
                                      placeholder="Custom item name"
                                      className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm font-medium focus:border-primary focus:outline-none"
                                    />
                                    <div className="flex gap-2">
                                      <input
                                        type="text"
                                        value={item.sku}
                                        onChange={(e) => patchBomItem(item, { sku: e.target.value })}
                                        placeholder="SKU"
                                        className="w-32 rounded-md border border-border bg-input px-2 py-1 text-[11px] font-mono focus:border-primary focus:outline-none"
                                      />
                                      <input
                                        type="text"
                                        value={item.supplier}
                                        onChange={(e) => patchBomItem(item, { supplier: e.target.value })}
                                        placeholder="Supplier"
                                        className="w-40 rounded-md border border-border bg-input px-2 py-1 text-[11px] focus:border-primary focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-start gap-2">
                                      {(() => {
                                        const product = rawProducts.find((p) => p.id === item.product_id);
                                        return product?.image_url ? (
                                          <img src={product.image_url} alt="" className="h-9 w-9 rounded border border-border object-contain bg-card shrink-0" />
                                        ) : null;
                                      })()}
                                      <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium truncate">{item.product_name}</p>
                                      {item.auto_added ? (
                                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Auto</span>
                                      ) : (
                                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Manual</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                      {item.sku && <span className="text-[11px] text-muted-foreground font-mono">{item.sku}</span>}
                                      {item.supplier && <span className="text-[11px] text-muted-foreground">{item.supplier}</span>}
                                      {(() => {
                                        const product = rawProducts.find((p) => p.id === item.product_id);
                                        if (!product) return null;
                                        return (
                                          <>
                                            {product.scope_role ? (
                                              <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400" title="Scope role — drives SoW placement">{product.scope_role}</span>
                                            ) : (
                                              <a href={`/settings/products`} target="_blank" rel="noopener" className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors" title="Missing scope role — click to tag">⚠ no scope</a>
                                            )}
                                            {product.labour_code ? (
                                              <span className="rounded bg-blue-500/10 px-1 py-0.5 text-[9px] font-medium text-blue-400" title="Labour code — drives labour calculation">{product.labour_code}</span>
                                            ) : (
                                              <a href={`/settings/products`} target="_blank" rel="noopener" className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors" title="Missing labour code — click to tag">⚠ no labour</a>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Qty + Pricing */}
                              <div className="flex items-center gap-3 shrink-0">
                                <input
                                  type="number"
                                  min="0"
                                  value={item.quantity}
                                  onChange={(e) => patchBomItem(item, { quantity: parseInt(e.target.value) || 0 })}
                                  className="w-14 rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none"
                                />
                                {isCustom ? (
                                  <>
                                    <div className="w-20">
                                      <p className="text-[10px] text-muted-foreground">Cost</p>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.cost_price || ""}
                                        onChange={(e) => patchBomItem(item, { cost_price: parseFloat(e.target.value) || 0 })}
                                        placeholder="$0"
                                        className="w-full rounded-md border border-border bg-input px-2 py-1 text-xs text-right font-mono focus:border-primary focus:outline-none"
                                      />
                                    </div>
                                    <div className="w-20">
                                      <p className="text-[10px] text-muted-foreground">Sell</p>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.sell_price || ""}
                                        onChange={(e) => patchBomItem(item, { sell_price: parseFloat(e.target.value) || 0 })}
                                        placeholder="$0"
                                        className="w-full rounded-md border border-border bg-input px-2 py-1 text-xs text-right font-mono focus:border-primary focus:outline-none"
                                      />
                                    </div>
                                  </>
                                ) : (
                                  <div className="hidden sm:block w-20 text-right">
                                    <p className="text-[10px] text-muted-foreground">Unit</p>
                                    <p className="text-xs font-mono">${fmt(item.sell_price)}</p>
                                  </div>
                                )}
                                <div className="w-24 text-right">
                                  <p className="text-[10px] text-muted-foreground">Line Total</p>
                                  <p className="text-sm font-mono font-medium">${fmt(item.sell_price * item.quantity)}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => deleteBomItem(item)}
                                  title="Remove item"
                                  className="text-muted-foreground hover:text-red-400 transition-colors"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {items.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                          No items. Add a product or custom item above.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Untagged-product warning — banner when any BOM line has a product
              with no scope_role assigned. They'll still appear in the SoW
              (under Miscellaneous) but tagging them puts them in the right
              system block with proper wording. */}
          {(() => {
            const lineItems = quoteMode === "manual" ? manualBomItems : bomItems;
            const productLookup = new Map(rawProducts.map((p) => [p.id, p]));
            const untagged: { name: string; sku: string }[] = [];
            const seen = new Set<string>();
            for (const it of lineItems) {
              const pid = (it as any).product_id;
              if (!pid || seen.has(pid)) continue;
              const product = productLookup.get(pid);
              if (!product) continue;
              if (!product.scope_role) {
                seen.add(pid);
                untagged.push({ name: product.name, sku: product.sku ?? "" });
              }
            }
            if (untagged.length === 0) return null;
            return (
              <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-start gap-3">
                  <svg className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                      {untagged.length} untagged {untagged.length === 1 ? "product" : "products"} on this BOM
                    </p>
                    <p className="text-[11px] text-amber-200/90 mt-1 leading-relaxed">
                      These products don't have a scope role and will land in the <strong>Additional items</strong> block on the scope of works. Tag them in <a href="/settings/products" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-100">Settings → Products</a> so they appear in the right system block.
                    </p>
                    <ul className="mt-2 space-y-0.5 text-[11px] text-amber-200/80">
                      {untagged.slice(0, 8).map((u, i) => (
                        <li key={i} className="font-mono">• {u.name}{u.sku ? ` (${u.sku})` : ""}</li>
                      ))}
                      {untagged.length > 8 && (
                        <li className="text-amber-200/60 italic">…and {untagged.length - 8} more</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Scope of Works preview — auto-generated from BOM */}
          <details className="mt-6 rounded-lg border border-border bg-card overflow-hidden group">
            <summary className="flex items-center justify-between bg-muted/40 px-4 py-2.5 cursor-pointer list-none select-none hover:bg-muted/60 transition-colors">
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scope of Works Preview</h3>
                <span className="text-[10px] text-muted-foreground/70">— auto-generated from this quote's BOM</span>
              </div>
            </summary>
            <div className="p-4">
              {(() => {
                const scopeBom = (quoteMode === "manual" ? manualBomItems : bomItems).map((it: any) => ({
                  product_id: it.product_id ?? null,
                  quantity: Number(it.quantity) || 0,
                }));
                const scopeProducts = rawProducts.map((p) => ({ id: p.id, scope_role: p.scope_role ?? null, name: p.name, sku: p.sku }));
                const scope = generateScopeOfWorks(scopeBom, scopeProducts, siteInfo);
                if (scope.systems.length === 0) {
                  return <p className="text-xs text-muted-foreground italic">Add items to the BOM to see the scope of works.</p>;
                }
                return (
                  <div className="space-y-3 text-xs">
                    {/* Summary lead */}
                    {scope.summary.lead && (
                      <p className="text-[11px] text-foreground/80 leading-relaxed">{scope.summary.lead}</p>
                    )}

                    {/* System cards */}
                    {scope.systems.map((sys) => (
                      <div key={sys.id} className="rounded-md border border-border bg-background overflow-hidden">
                        <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-foreground text-[10px] font-bold text-background">{sys.iconLabel}</span>
                            <span className="text-[12px] font-semibold text-foreground">{sys.name}</span>
                          </div>
                          {sys.countSummary && (
                            <span className="text-[10px] font-mono text-muted-foreground">{sys.countSummary}</span>
                          )}
                        </div>
                        <div className="px-3 py-2">
                          {sys.lead && <p className="text-[11px] text-foreground/80 mb-1.5 leading-relaxed">{sys.lead}</p>}
                          <ul className="space-y-1">
                            {sys.items.map((it, i) => (
                              <li key={i} className="text-[11px] text-muted-foreground leading-relaxed pl-3 relative">
                                <span className="absolute left-0 top-2 h-1 w-1 rounded-full bg-emerald-500" />
                                <span dangerouslySetInnerHTML={{ __html: it }} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}

                    {/* By Others */}
                    {scope.byOthers.map((blk) => (
                      <div key={blk.id} className="rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                        <div className="px-3 py-1.5 bg-amber-500/10">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">{blk.name}</span>
                        </div>
                        <ul className="px-3 py-2 space-y-1">
                          {blk.items.map((it, i) => (
                            <li key={i} className="text-[11px] text-amber-200/90 leading-relaxed pl-3 relative">
                              <span className="absolute left-0 top-2 h-1 w-1 rounded-full bg-amber-500" />
                              <span dangerouslySetInnerHTML={{ __html: it }} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}

                    {/* Hard exclusion */}
                    {scope.hardExclusion && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-center text-[11px] font-semibold text-destructive">
                        {scope.hardExclusion}
                      </div>
                    )}

                    {/* Ongoing costs */}
                    {scope.ongoingCosts.length > 0 && (
                      <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Ongoing Costs</p>
                        {scope.ongoingCosts.map((c, i) => (
                          <div key={c.id} className={`flex justify-between gap-3 py-0.5 text-[11px] ${i < scope.ongoingCosts.length - 1 ? "border-b border-dashed border-border" : ""}`}>
                            <span className="text-muted-foreground">{c.desc}</span>
                            <span className="font-mono text-foreground">{c.price}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </details>
        </div>
      )}

      {/* STEP 4: LABOUR */}
      {/* Legacy manual labour UI — only renders if labourData hasn't been generated
          yet (e.g. opening an old manual quote saved before the labour engine
          was unified). Entering the Labour step now auto-generates labourData
          for both modes, so this branch is mostly a safety net. */}
      {step === 3 && quoteMode === "manual" && !labourData && (
        <div className="space-y-5 max-w-2xl">
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Hours</p>
              <p className="text-lg font-bold font-mono mt-1">{manualLabourHours}h</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Labour Rate</p>
              <p className="text-lg font-bold font-mono mt-1">${fmt(sellRate)}/hr</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Callout</p>
              <p className="text-lg font-bold font-mono mt-1">${fmt(calloutTotal)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Labour Total</p>
              <p className="text-lg font-bold font-mono mt-1">${fmt(manualLabourHours * sellRate + calloutTotal + manualLabourAmount)}</p>
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/50 px-4 py-2.5 border-b border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Labour</h3>
            </div>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm">Labour Hours</p>
                  <p className="text-[10px] text-muted-foreground">Rate: ${fmt(sellRate)}/hr (cost: ${fmt(costRate)}/hr)</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={manualLabourHours || ""}
                    onChange={(e) => setManualLabourHours(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-20 rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[10px] text-muted-foreground w-6">hrs</span>
                  <span className="w-24 text-right text-sm font-mono">${fmt(manualLabourHours * sellRate)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm">Callout</p>
                  <p className="text-[10px] text-muted-foreground">$80 per day on site</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={manualCalloutDays || ""}
                    onChange={(e) => setManualCalloutDays(parseInt(e.target.value) || 0)}
                    placeholder="0"
                    className="w-20 rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[10px] text-muted-foreground w-6">days</span>
                  <span className="w-24 text-right text-sm font-mono">${fmt(manualCalloutDays * 80)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm">Additional Costs</p>
                  <p className="text-[10px] text-muted-foreground">Flat amount for misc labour costs</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={manualLabourAmount || ""}
                    onChange={(e) => setManualLabourAmount(parseFloat(e.target.value) || 0)}
                    placeholder="$0"
                    className="w-20 rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[10px] text-muted-foreground w-6">$</span>
                  <span className="w-24 text-right text-sm font-mono">${fmt(manualLabourAmount)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border">
              <span className="text-xs font-medium text-muted-foreground">Total Labour (sell)</span>
              <span className="text-sm font-mono font-medium">${fmt(manualLabourHours * sellRate + calloutTotal + manualLabourAmount)}</span>
            </div>
          </div>
        </div>
      )}

      {step === 3 && labourData && (
        <div className="space-y-5">
          {/* Docklands warning */}
          {labourWarnings.length > 0 && (
            <div className="rounded-lg border-2 border-red-500 bg-red-500/10 p-4">
              <p className="text-sm font-bold text-red-400">WARNING — MANDATORY LABOUR MISSING</p>
              {labourWarnings.map((w, i) => (<p key={i} className="text-xs text-red-400 mt-1">{w.name}: {w.warning}</p>))}
            </div>
          )}

          {/* Labour totals at top */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Hours</p>
              <p className="text-lg font-bold font-mono mt-1">{labourData.grandTotalHours}h</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Cost</p>
              <p className="text-lg font-bold font-mono mt-1">${fmt(labourData.grandTotalCost)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Sell</p>
              <p className="text-lg font-bold font-mono mt-1">${fmt(labourData.grandTotalSell)}</p>
            </div>
          </div>

          {/* Labour sections */}
          {labourData.sections.map((section, si) => (
            <div key={section.name} className="rounded-lg border border-border overflow-hidden">
              {/* Section header */}
              <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.name}</h3>
                  {section.mandatory && <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">Mandatory</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addLabourLine(si)}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    + Line
                  </button>
                  <span className="ml-2 text-xs font-mono text-muted-foreground">{section.totalHours}h</span>
                  <span className="text-xs font-mono text-muted-foreground">${fmt(section.totalSell)}</span>
                </div>
              </div>

              {section.warning && (
                <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-2">
                  <p className="text-xs font-bold text-red-400">{section.warning}</p>
                </div>
              )}

              {/* Items */}
              <div className="divide-y divide-border">
                {section.items.map((item, ii) => (
                  <div key={`${si}-${ii}`} className="flex items-center gap-4 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      {item.isCustom ? (
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateLabourName(si, ii, e.target.value)}
                          placeholder="Line item name"
                          className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm focus:border-primary focus:outline-none"
                        />
                      ) : (
                        <>
                          <p className="text-sm">{item.name}</p>
                          <p className="text-[10px] text-muted-foreground">{item.formula}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 w-[7.5rem] justify-end">
                        <input
                          type="number"
                          min="0"
                          step={item.isDollarInput ? "1" : item.unitRate ? "1" : "0.25"}
                          value={item.hours}
                          onChange={(e) => updateLabourHours(si, ii, parseFloat(e.target.value) || 0)}
                          className="w-20 rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-[10px] text-muted-foreground w-6">{item.isDollarInput ? '$' : item.unitLabel || 'hrs'}</span>
                      </div>
                      <span className="w-20 text-right text-sm font-mono">
                        ${fmt(item.isDollarInput ? item.hours : item.unitRate ? item.hours * item.unitRate : item.hours * (labourData?.sellRate || 150))}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteLabourLine(si, ii)}
                        title="Remove line"
                        className="text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
                {section.items.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No lines. Click + Line to add one.
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Fixed costs */}
          {labourData.fixedCosts.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/50 px-4 py-2.5 border-b border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fixed Costs</h3>
            </div>
            <div className="divide-y divide-border">
              {labourData.fixedCosts.map((fc, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm">{fc.name}</span>
                  <div className="flex gap-6 text-sm font-mono">
                    <span className="text-muted-foreground w-24 text-right">Cost ${fmt(fc.cost)}</span>
                    <span className="w-24 text-right">Sell ${fmt(fc.sell)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      )}

      {/* STEP 5: EXTRAS */}
      {step === 4 && (
        <div className="max-w-2xl">
          <p className="text-xs text-muted-foreground mb-4">Freight, travel, accommodation, and other costs. Leave at $0 for items not applicable.</p>
          <div className="rounded-lg border border-border overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_120px] gap-3 bg-muted/50 px-4 py-2.5 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground">Item</span>
              <span className="text-xs font-medium text-muted-foreground text-center">Amount</span>
            </div>
            {/* Rows */}
            <div className="divide-y divide-border">
              {extras.map((extra, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px] gap-3 items-center px-4 py-2.5">
                  <div>
                    <span className="text-sm">{extra.description}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{extra.category}</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={extra.sell || ""}
                    onChange={(e) => { const v = parseFloat(e.target.value) || 0; setExtras((prev) => prev.map((ex, ei) => ei === i ? { ...ex, cost: v, sell: v } : ex)); }}
                    placeholder="$0"
                    className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              ))}
            </div>
            {/* Totals */}
            {extras.some((e) => e.sell > 0) && (
              <div className="grid grid-cols-[1fr_120px] gap-3 items-center px-4 py-2.5 bg-muted/30 border-t border-border">
                <span className="text-xs font-medium text-muted-foreground">Total Extras</span>
                <span className="text-sm font-mono text-right">${fmt(extras.reduce((s, e) => s + e.sell, 0))}</span>
              </div>
            )}
          </div>

          {/* Electrician */}
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-foreground">Electrician</h3>
              {isInterstate && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500">REQUIRED — Interstate</span>}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {isInterstate
                ? "Interstate job — electrician quote is mandatory. Cost is doubled (2x). Select what the electrician is covering below."
                : "Enter the electrician's quoted cost. A 30% margin is applied automatically."}
            </p>

            {/* Electrician scope toggles — interstate only */}
            {isInterstate && (
              <div className="flex gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={elecDoingRoughIn} onChange={(e) => setElecDoingRoughIn(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary" />
                  <span className="text-sm">Electrician doing Rough In</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={elecDoingFitOff} onChange={(e) => setElecDoingFitOff(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary" />
                  <span className="text-sm">Electrician doing Fit Off</span>
                </label>
              </div>
            )}

            {isInterstate && electricianCost === 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-3">
                <p className="text-xs text-amber-500 font-medium">Electrician quote is required for interstate jobs. Enter the cost below.</p>
              </div>
            )}

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-[1fr_120px_120px] gap-3 bg-muted/50 px-4 py-2.5 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground">Item</span>
                <span className="text-xs font-medium text-muted-foreground text-center">Cost</span>
                <span className="text-xs font-medium text-muted-foreground text-center">Sell ({isInterstate ? "2x" : "+ 30%"})</span>
              </div>
              <div className="grid grid-cols-[1fr_120px_120px] gap-3 items-center px-4 py-2.5">
                <span className="text-sm">Electrician Quotation</span>
                <input
                  type="number"
                  min="0"
                  value={electricianCost || ""}
                  onChange={(e) => setElectricianCost(parseFloat(e.target.value) || 0)}
                  placeholder="$0"
                  className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm font-mono text-center text-muted-foreground">
                  ${fmt(Math.round(electricianCost * (isInterstate ? 2 : 1.3) * 100) / 100)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 6: SUMMARY */}
      {step === 5 && summary && (
        <div className="space-y-6">
          {/* Quote type / mode badges */}
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${quoteType === "progress" ? "bg-primary/10 text-primary" : "bg-muted text-foreground"}`}>
              {quoteType === "progress" ? "Progress Payments" : "Full Quote"}
            </span>
            {quoteMode === "manual" && (
              <span className="rounded-full px-3 py-1 text-xs font-medium bg-muted text-foreground">Manual Quote</span>
            )}
          </div>

          {/* Manual scope of works preview */}
          {quoteMode === "manual" && manualScope && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Scope of Works</h3>
              <p className="text-sm whitespace-pre-wrap">{manualScope}</p>
            </div>
          )}

          {/* Internal breakdown — always shown */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Internal Breakdown</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><p className="text-[10px] text-muted-foreground uppercase">Materials</p><p className="font-mono mt-0.5">Cost ${fmt(summary.materials.cost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(summary.materials.sell)}</p></div>
              <div><p className="text-[10px] text-muted-foreground uppercase">Labour</p><p className="font-mono mt-0.5">Cost ${fmt(summary.labour.totalCost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(summary.labour.totalSell)}</p></div>
              <div><p className="text-[10px] text-muted-foreground uppercase">Fixed</p><p className="font-mono mt-0.5">Cost ${fmt(summary.fixedCosts.totalCost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(summary.fixedCosts.totalSell)}</p></div>
              <div><p className="text-[10px] text-muted-foreground uppercase">Extras</p><p className="font-mono mt-0.5">Cost ${fmt(summary.extras.cost)}</p><p className="font-mono text-muted-foreground">Sell ${fmt(summary.extras.sell)}</p></div>
            </div>
          </div>

          {/* Progress Payment breakdown — only for progress quotes */}
          {quoteType === "progress" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">PP1 — Due on Acceptance</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Parts Cost</span><span className="font-mono">${fmt(summary.pp1.partsCost)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Labour Cost</span><span className="font-mono">${fmt(summary.pp1.labourCost)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Callout</span><span className="font-mono">${fmt(summary.pp1.callout)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Incidentals</span><span className="font-mono">${fmt(summary.pp1.incidentals)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Admin</span><span className="font-mono">${fmt(summary.pp1.admin)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Extras</span><span className="font-mono">${fmt(summary.pp1.extrasCost)}</span></div>
                  <div className="flex justify-between border-t border-border pt-2 font-medium"><span>PP1 Total</span><span className="font-mono">${fmt(summary.pp1.total)}</span></div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">PP2 — Due on Completion</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Parts Markup</span><span className="font-mono">${fmt(summary.pp2.partsProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Labour Profit</span><span className="font-mono">${fmt(summary.pp2.labourProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fixed Profit</span><span className="font-mono">${fmt(summary.pp2.fixedProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Extras Profit</span><span className="font-mono">${fmt(summary.pp2.extrasProfit)}</span></div>
                  <div className="flex justify-between border-t border-border pt-2 font-medium"><span>PP2 Total</span><span className="font-mono">${fmt(summary.pp2.total)}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="rounded-lg border-2 border-primary/30 bg-card p-6 text-center space-y-3">
            <div><p className="text-xs text-muted-foreground uppercase">Total Price (ex GST)</p><p className="text-2xl font-bold font-mono">${fmt(summary.totalExGST)}</p></div>
            <div><p className="text-xs text-muted-foreground">GST (10%)</p><p className="text-lg font-mono">${fmt(summary.gst)}</p></div>
            <div className="border-t border-border pt-3"><p className="text-xs text-muted-foreground uppercase">Total (inc GST)</p><p className="text-3xl font-bold font-mono">${fmt(summary.totalIncGST)}</p></div>

            {quoteType === "progress" && (
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border">
                <div><p className="text-[10px] text-muted-foreground uppercase">PP1 (inc GST)</p><p className="text-lg font-bold font-mono">${fmt(summary.pp1.total * 1.1)}</p></div>
                <div><p className="text-[10px] text-muted-foreground uppercase">PP2 (inc GST)</p><p className="text-lg font-bold font-mono">${fmt(summary.pp2.total * 1.1)}</p></div>
              </div>
            )}

            <div className="pt-2"><p className="text-xs text-muted-foreground uppercase">Total Profit</p><p className="text-2xl font-bold font-mono text-emerald-400">${fmt(summary.profit)}</p></div>
          </div>

          {/* Discount toggle */}
          <label className="flex items-center gap-3 text-sm">
            <button type="button" onClick={() => setDiscountPercent(discountPercent > 0 ? 0 : 5)} className={`relative h-5 w-9 rounded-full transition-colors ${discountPercent > 0 ? "bg-primary" : "bg-muted"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${discountPercent > 0 ? "left-[18px]" : "left-0.5"}`} />
            </button>
            Apply 5% discount
          </label>
          {discountPercent > 0 && (
            <p className="text-xs text-muted-foreground">Full price: ${fmt(summary.fullPriceExGST)} ex GST — showing ${fmt(summary.targetExGST)} (saves ${fmt(summary.discount.amount)})</p>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-3 mt-8 pt-4 border-t border-border">
        {step > 0 && (
          <button onClick={() => enterStep(step - 1)} className="rounded-md border border-border px-5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Back</button>
        )}
        <div className="flex-1" />
        {step < STEPS.length - 1 && (() => {
          const blocked = step === 0 && !linkedJobId;
          return (
            <button
              onClick={() => enterStep(step + 1)}
              disabled={blocked}
              title={blocked ? "Link this quote to a job to continue" : undefined}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >Next</button>
          );
        })()}
        {step === STEPS.length - 1 && (
          <button onClick={handleSave} disabled={saving || labourWarnings.length > 0} className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving..." : "Save Quote"}
          </button>
        )}
      </div>
    </div>
  );
}
