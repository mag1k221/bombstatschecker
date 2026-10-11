"use client";

import { CircleHelp, Crosshair, HeartPulse, Shield, Swords, WandSparkles } from "lucide-react";
import clsx from "clsx";
import { useState } from "react";
import type { MemberWeapon } from "@/lib/stats/compute";
import { ROLE_LABELS, type Role } from "@/lib/weapons/roles";

const ROLE_ICONS: Record<Role, typeof Shield> = {
  tank: Shield,
  healer: HeartPulse,
  support: WandSparkles,
  melee: Swords,
  ranged: Crosshair,
  unknown: CircleHelp,
};

export function RoleIcon({ role, className }: { role: Role; className?: string }) {
  const Icon = ROLE_ICONS[role];
  return <Icon className={clsx("size-3.5", className)} aria-hidden />;
}

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      title="Role inferred from the weapon used in this battle"
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-medium leading-5",
        role === "unknown" ? "text-subtle" : "text-fg",
        className,
      )}
    >
      <RoleIcon role={role} className="size-3 text-muted" />
      {ROLE_LABELS[role]}
    </span>
  );
}

/** Official item render from Sandbox Interactive's render service. Falls back to a neutral tile. */
export function WeaponIcon({ weapon, className = "size-7 sm:size-9" }: { weapon: MemberWeapon | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!weapon || failed) {
    return (
      <span className={clsx("grid shrink-0 place-items-center rounded-[10px] border border-line bg-surface-2 text-subtle", className)} aria-hidden>
        <CircleHelp className="size-3.5" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://render.albiononline.com/v1/item/${encodeURIComponent(weapon.type)}.png?size=72`}
      alt={weaponLabel(weapon)}
      title={weaponLabel(weapon)}
      width={36}
      height={36}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={clsx("shrink-0 rounded-[10px] bg-surface-2 object-contain", className)}
    />
  );
}

export function weaponLabel(w: MemberWeapon): string {
  return `${w.name}${w.tier ? ` · T${w.tier}${w.enchant ? `.${w.enchant}` : ""}` : ""}`;
}
