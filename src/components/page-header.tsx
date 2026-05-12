"use client";

import { useRouter } from "next/navigation";
import { NotificationsBell } from "@/components/notifications-bell";
import type React from "react";

interface PageHeaderProps {
  title: React.ReactNode;
  back?: boolean;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
}

export function PageHeader({ title, back = false, actions, subtitle }: PageHeaderProps) {
  const router = useRouter();

  return (
    <div
      className="sticky top-0 z-30 -mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-4 md:mb-6 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center gap-2 px-4 md:px-6">
        {back && (
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-11 w-11 -ml-2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Back"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base md:text-[15px] font-semibold text-foreground truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 -mr-2">
          {actions}
          <NotificationsBell />
        </div>
      </div>
    </div>
  );
}

interface PageHeaderActionProps {
  onClick?: () => void;
  href?: string;
  label: string;
  children: React.ReactNode;
}

export function PageHeaderAction({ onClick, href, label, children }: PageHeaderActionProps) {
  const className = "inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
  if (href) {
    return (
      <a href={href} className={className} aria-label={label}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} aria-label={label}>
      {children}
    </button>
  );
}
