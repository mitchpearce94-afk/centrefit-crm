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
  getSnapFitnessRules,
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
  is_default: boolean;
  is_active: boolean;
}

const STEPS = ["Client", "Devices", "BOM", "Labour", "Extras", "Summary"];

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
  labourTimings = {},
}: {
  customers: CustomerOption[];
  products: QuoteProduct[];
  plans: PlanFile[];
  existingQuote?: ExistingQuote;
  billingSettings?: any;
  jobs?: { id: string; number: string; customer_name: string | null }[];
  labourTimings?: LabourTimingOverrides;
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

  // Auto-prefill customer + site from linked job (?job=X in URL)
  // Runs after plan auto-select so the job's specific site wins over the plan's first-site fallback.
  useEffect(() => {
    const jobParam = searchParams.get("job");
    if (!jobParam || isEditing) return;
    supabase
      .from("jobs")
      .select("id, customer_id, site_id, customer:customers!customer_id(id, name, customer_sites(id, name, address, suburb, state, postcode))")
      .eq("id", jobParam)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const job = data as any;
        if (job.customer_id) {
          // Ensure the customer is in our local list (in case it was freshly created)
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
  }, []);

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

  function regenerateLabour() {
    const source = bomGenerated ? bomDeviceCounts : deviceCounts;
    const fresh = calculateLabour(source, siteInfo, billingSettings ? {
      labourCostRate: billingSettings.labour_cost_rate,
      labourSellRate: billingSettings.labour_sell_rate,
    } : {}, labourTimings, { elecDoingRoughIn, elecDoingFitOff });

    if (!labourData) {
      setLabourData(fresh);
      return;
    }

    // Merge with existing labourData:
    // - Formula-driven items: if user previously overrode hours (hours != defaultHours),
    //   preserve their override. Otherwise use the fresh value.
    // - Custom items (isCustom): preserved entirely (name, hours, etc).
    const merged = {
      ...fresh,
      sections: fresh.sections.map((section) => {
        const oldSection = labourData.sections.find((s) => s.name === section.name);
        if (!oldSection) return section;

        const mergedFormulaItems = section.items.map((newItem) => {
          const oldItem = oldSection.items.find(
            (it) => it.name === newItem.name && !it.isCustom
          );
          if (!oldItem) return newItem;
          const userOverrode = Math.abs(oldItem.hours - oldItem.defaultHours) > 0.001;
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
    if (quoteMode !== "plan") return;
    if (!bomGenerated) return;
    if (!labourData) return;
    regenerateLabour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomItems]);

  function enterStep(newStep: number) {
    if (quoteMode === "plan") {
      if (newStep === 2 && !bomGenerated) {
        const rules = getSnapFitnessRules(products);
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
    }
    setStep(newStep);
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function regenerateBOM() {
    const rules = getSnapFitnessRules(products);
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
      return calculateQuoteSummary(manualBomAsBomItems, manualLabourData, extras, { discountPercent, electricianCost, isInterstate });
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
    const updated = {
      ...labourData,
      sections: labourData.sections.map((s, idx) =>
        idx !== si ? s : { ...s, items: s.items.filter((_, jdx) => jdx !== ii) }
      ),
    };
    setLabourData(recalcLabour(updated));
  }

  async function handleSave() {
    const effectiveLabourData = quoteMode === "manual" ? manualLabourData : labourData;
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
        ...(quoteMode === "manual" ? { scope_of_works: manualScope, quote_mode: "manual" } : { quote_mode: "plan" }),
      },
      discount_percent: discountPercent,
      electrician_cost: electricianCost || 0,
      elec_doing_rough_in: elecDoingRoughIn,
      elec_doing_fit_off: elecDoingFitOff,
      quote_type: quoteType,
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
      // INSERT new quote
      const { count } = await supabase.from("quotes").select("id", { count: "exact", head: true });
      const ref = `CF-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, "0")}`;

      const { data: newQuote, error } = await supabase.from("quotes").insert({
        ...quotePayload,
        ref,
        status: "draft",
        created_by: user?.id ?? null,
      }).select("id").single();

      if (error || !newQuote) {
        toast(error?.message || "Failed to save", "error");
        setSaving(false);
        return;
      }
      quoteId = newQuote.id;
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

          {/* Manual Scope of Works — manual mode only */}
          {quoteMode === "manual" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Scope of Works</label>
              <textarea
                value={manualScope}
                onChange={(e) => setManualScope(e.target.value)}
                rows={5}
                placeholder="Describe the scope of works for this quote..."
                className={inputClass}
              />
            </div>
          )}

          {/* Link to Job */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Link to Job</label>
            <select value={linkedJobId} onChange={(e) => setLinkedJobId(e.target.value)} className={inputClass}>
              <option value="">No job linked</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number}{j.customer_name ? ` — ${j.customer_name}` : ''}
                </option>
              ))}
            </select>
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

          {/* Customer / Site Search */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Customer / Site</label>
            {customerId ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                <div className="flex-1">
                  <span className="text-sm font-medium">{selectedCustomer?.name}</span>
                  {selectedSite && <span className="text-sm text-muted-foreground"> — {selectedSite.name}</span>}
                </div>
                <button type="button" onClick={() => { setCustomerId(""); setSiteId(""); setCustomerSearch(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Change</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by customer name or site name..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className={inputClass}
                />
                {customerSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                    {customerSearchResults.map((result, i) => (
                      <button
                        key={`${result.customerId}-${result.siteId ?? "no-site"}-${i}`}
                        type="button"
                        onClick={() => {
                          selectCustomer(result.customerId);
                          if (result.siteId) selectSite(result.siteId);
                          setCustomerSearch("");
                        }}
                        className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors border-b border-border last:border-0"
                      >
                        <div>
                          {result.siteName ? (
                            <>
                              <span className="font-medium">{result.siteName}</span>
                              <span className="block text-xs text-muted-foreground">Customer: {result.customerName}</span>
                            </>
                          ) : (
                            <span className="font-medium">{result.customerName}</span>
                          )}
                        </div>
                        {result.siteName && (
                          <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Site</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {customerSearch.length >= 2 && customerSearchResults.length === 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-card px-3 py-3 text-sm text-muted-foreground shadow-xl">
                    No customers or sites found
                  </div>
                )}
              </div>
            )}

            {/* Site picker if customer selected but no site via search */}
            {customerId && !siteId && selectedCustomer && selectedCustomer.customer_sites.length > 0 && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Select site</label>
                <select value={siteId} onChange={(e) => selectSite(e.target.value)} className={inputClass}>
                  <option value="">No specific site</option>
                  {selectedCustomer.customer_sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </div>
            )}

            {/* Primary contact */}
            {selectedCustomer && selectedCustomer.customer_contacts.length > 0 && (
              <div className="mt-2 rounded-md border border-border bg-card px-3 py-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Primary Contact</p>
                {(() => {
                  const contact = selectedCustomer.customer_contacts.find((c) => c.is_primary) || selectedCustomer.customer_contacts[0];
                  return (
                    <div className="flex gap-4 text-sm">
                      <span className="font-medium">{contact.name}</span>
                      {(contact.mobile || contact.phone) && <span className="text-muted-foreground">{contact.mobile || contact.phone}</span>}
                      {contact.email && <span className="text-muted-foreground">{contact.email}</span>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Manual entry fields (shown when no customer selected) */}
          {!customerId && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Client Name</label>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Snap Fitness" className={inputClass} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Site Name</label>
              <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="e.g. Pimpama" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Site Address</label>
              <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} className={inputClass} />
            </div>
          </div>
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
        <div className="space-y-6">
          {quoteMode === "manual" ? (
            <>
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <p className="text-sm text-primary">Manual quote — device counts not required. Enter site info for dependency rules if applicable.</p>
              </div>
              <h3 className="text-sm font-semibold">Site Info</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl">
                {([["site_sqm","Site Area (sqm)"],["door_count","Door Count"],["external_camera_count","External Cameras"],["concrete_mount_black","Concrete Mounts (Black)"],["concrete_mount_white","Concrete Mounts (White)"],["cardio_count","Cardio Machines"],["tv_count","Wall TVs"],["ceiling_tv_count","Ceiling TVs"],["wall_tv_mount_count","Wall TV Mounts"],["ceiling_tv_mount_count","Ceiling TV Mounts"]] as [keyof SiteInfo, string][]).map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
                    <input type="number" min="0" value={(siteInfo[field] as number) || ""} onChange={(e) => setSI(field, parseInt(e.target.value) || 0)} className={`${inputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm mt-2">
                <button type="button" onClick={() => setSI("separate_studio_zone", !siteInfo.separate_studio_zone)} className={`relative h-5 w-9 rounded-full transition-colors ${siteInfo.separate_studio_zone ? "bg-primary" : "bg-muted"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${siteInfo.separate_studio_zone ? "left-[18px]" : "left-0.5"}`} />
                </button>
                Separate Studio Zone
              </label>
            </>
          ) : (
            <>
              {/* Device count summary */}
              {Object.values(deviceCounts).some((v) => v > 0) && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <p className="text-xs font-medium text-primary mb-1">
                    {Object.values(deviceCounts).reduce((a, b) => a + b, 0)} devices selected
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(deviceCounts).filter(([, v]) => v > 0).map(([code, count]) => {
                      const dt = DEVICE_TYPES.find((d) => d.code === code);
                      return (
                        <span key={code} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {count}x {dt?.legend || code}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="lg:columns-2 gap-6 space-y-6">
                {Array.from(devicesByCategory).map(([category, types]) => (
                  <div key={category} className="rounded-lg border border-border bg-card overflow-hidden break-inside-avoid">
                    <div className="bg-muted/50 px-4 py-2 border-b border-border">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</h3>
                    </div>
                    <div className="divide-y divide-border">
                      {types.map((dt) => {
                        const count = deviceCounts[dt.code] || 0;
                        return (
                          <div key={dt.code} className={`flex items-center justify-between px-4 py-2.5 ${count > 0 ? "bg-primary/[0.03]" : ""}`}>
                            <span className="text-sm">{dt.legend}</span>
                            <input
                              type="number"
                              min="0"
                              value={count || ""}
                              onChange={(e) => setDC(dt.code, parseInt(e.target.value) || 0)}
                              placeholder="0"
                              className={`w-16 rounded-md border bg-input px-2 py-1 text-sm text-center font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${count > 0 ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
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
                            <div>
                              <p className="text-sm font-medium truncate">{item.product_name}</p>
                              <p className="text-[11px] text-muted-foreground font-mono truncate">{item.sku}</p>
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
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium truncate">{item.product_name}</p>
                                      {item.auto_added ? (
                                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Auto</span>
                                      ) : (
                                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Manual</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5">
                                      {item.sku && <span className="text-[11px] text-muted-foreground font-mono">{item.sku}</span>}
                                      {item.supplier && <span className="text-[11px] text-muted-foreground">{item.supplier}</span>}
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
        </div>
      )}

      {/* STEP 4: LABOUR */}
      {step === 3 && quoteMode === "manual" && (
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

      {step === 3 && quoteMode === "plan" && labourData && (
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
        {step < STEPS.length - 1 && (
          <button onClick={() => enterStep(step + 1)} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Next</button>
        )}
        {step === STEPS.length - 1 && (
          <button onClick={handleSave} disabled={saving || labourWarnings.length > 0} className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? "Saving..." : "Save Quote"}
          </button>
        )}
      </div>
    </div>
  );
}
