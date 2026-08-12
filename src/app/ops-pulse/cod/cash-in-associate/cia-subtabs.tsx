"use client";

import Link from "next/link";

const tabs = [
  { href: "/cod/cash-in-associate", key: "stations", label: "Stations" },
  { href: "/cod/cash-in-associate/daily-ledger", key: "daily-ledger", label: "Day-wise ledger" }
] as const;

export function CiaSubTabs({ active }: { active: (typeof tabs)[number]["key"] }) {
  return (
    <section className="tabs cia-subtabs" aria-label="Cash In Associate views">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          className={`tab ${active === tab.key ? "active" : ""}`}
          href={tab.href}
          prefetch={false}
        >
          {tab.label}
        </Link>
      ))}
    </section>
  );
}
