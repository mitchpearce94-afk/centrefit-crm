"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { DealStage, Category, Status } from "@/lib/types";
import { DealForm } from "./deal-form";
import { JobForm } from "../jobs/job-form";
import { useToast } from "@/components/ui/toast";

interface Deal {
  id: string;
  title: string;
  description: string | null;
  stage: DealStage;
  contact_name: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  customer?: { id: string; name: string };
  assigned_staff?: { id: string; display_name: string; initials: string; colour: string };
  updated_at: string;
}

interface CustomerOption {
  id: string;
  name: string;
  customer_sites: { id: string; name: string }[];
}

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

const STAGES: { id: DealStage; label: string; colour: string }[] = [
  { id: "lead", label: "Lead", colour: "#6b7280" },
  { id: "quote_sent", label: "Quote Sent", colour: "#8b5cf6" },
];

export function PipelineBoard({
  deals,
  customers,
  staff,
  categories,
  statuses,
}: {
  deals: Deal[];
  customers: CustomerOption[];
  staff: StaffOption[];
  categories: Category[];
  statuses: Status[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [showForm, setShowForm] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [movingDeal, setMovingDeal] = useState<string | null>(null);
  const [convertingDeal, setConvertingDeal] = useState<Deal | null>(null);

  // Group deals by stage (only show lead + quote_sent)
  const dealsByStage = useMemo(() => {
    const map = new Map<DealStage, Deal[]>();
    for (const stage of STAGES) {
      map.set(stage.id, []);
    }
    for (const deal of deals) {
      const list = map.get(deal.stage);
      if (list) {
        list.push(deal);
        map.set(deal.stage, list);
      }
    }
    return map;
  }, [deals]);

  const activeDeals = deals.filter((d) => d.stage === "lead" || d.stage === "quote_sent");

  async function moveDeal(dealId: string, newStage: DealStage) {
    setMovingDeal(dealId);
    const { error } = await supabase
      .from("pipeline_deals")
      .update({ stage: newStage })
      .eq("id", dealId);
    if (error) {
      toast(error.message, "error");
    } else {
      router.refresh();
    }
    setMovingDeal(null);
  }

  function acceptDeal(deal: Deal) {
    setConvertingDeal(deal);
  }

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="rounded-lg border border-border bg-card px-4 py-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Active Deals</p>
          <p className="text-lg font-bold">{activeDeals.length}</p>
        </div>
        <button
          onClick={() => {
            setEditingDeal(null);
            setShowForm(true);
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          New Deal
        </button>
      </div>

      {/* Kanban columns */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];

          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-64 lg:w-auto lg:flex-1"
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: stage.colour }}
                />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {stage.label}
                </span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {stageDeals.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[200px] rounded-lg bg-muted/30 p-2">
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    stages={STAGES}
                    onEdit={() => {
                      setEditingDeal(deal);
                      setShowForm(true);
                    }}
                    onMove={(newStage) => moveDeal(deal.id, newStage)}
                    onAccept={() => acceptDeal(deal)}
                    moving={movingDeal === deal.id}
                  />
                ))}

                {stageDeals.length === 0 && (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No deals
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Deal form modal */}
      {showForm && (
        <DealForm
          deal={editingDeal}
          customers={customers}
          staff={staff}
          onClose={() => {
            setShowForm(false);
            setEditingDeal(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditingDeal(null);
            router.refresh();
          }}
        />
      )}

      {/* Convert to Job modal */}
      {convertingDeal && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConvertingDeal(null)} />
          <div className="relative w-full max-w-2xl rounded-t-2xl lg:rounded-2xl border border-border bg-card shadow-2xl max-h-[90dvh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">Convert to Job</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {convertingDeal.title}
                    {convertingDeal.customer && ` — ${convertingDeal.customer.name}`}
                  </p>
                </div>
                <button
                  onClick={() => setConvertingDeal(null)}
                  className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <JobForm
                customers={customers}
                categories={categories}
                statuses={statuses}
                staff={staff}
                prefill={{
                  fromDealId: convertingDeal.id,
                  customerId: convertingDeal.customer_id ?? undefined,
                  reference: convertingDeal.title,
                  description: convertingDeal.description ?? undefined,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Deal Card ── */
function DealCard({
  deal,
  stages,
  onEdit,
  onMove,
  onAccept,
  moving,
}: {
  deal: Deal;
  stages: typeof STAGES;
  onEdit: () => void;
  onMove: (stage: DealStage) => void;
  onAccept: () => void;
  moving: boolean;
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const isQuoteSent = deal.stage === "quote_sent";

  return (
    <div
      className={`rounded-lg border border-border bg-card p-3 cursor-pointer hover:border-primary/50 transition-colors ${
        moving ? "opacity-50" : ""
      }`}
      onClick={onEdit}
    >
      {/* Title */}
      <p className="text-sm font-medium leading-tight">{deal.title}</p>

      {/* Customer */}
      {deal.customer && (
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {deal.customer.name}
        </p>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          {deal.assigned_staff && (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-medium text-white"
              style={{ backgroundColor: deal.assigned_staff.colour }}
            >
              {deal.assigned_staff.initials}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Accepted button — only on Quote Sent cards */}
          {isQuoteSent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAccept();
              }}
              className="rounded-md bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500 hover:bg-emerald-500/20 transition-colors"
            >
              Accepted
            </button>
          )}

          {/* Move stage button */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMoveMenu(!showMoveMenu);
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            {showMoveMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoveMenu(false);
                  }}
                />
                <div className="absolute right-0 bottom-full z-50 mb-1 w-40 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase bg-muted/50">
                    Move to
                  </div>
                  {stages
                    .filter((s) => s.id !== deal.stage)
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMoveMenu(false);
                          onMove(s.id);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: s.colour }}
                        />
                        {s.label}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
