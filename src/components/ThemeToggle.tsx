"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import clsx from "clsx";

type Mode = "light" | "dark" | "system";
const MODES: { mode: Mode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "system", label: "System", Icon: Monitor },
  { mode: "dark", label: "Dark", Icon: Moon },
];

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Mode | null) ?? "system";
    setMode(saved);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => (localStorage.getItem("theme") ?? "system") === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const choose = (m: Mode) => {
    setMode(m);
    localStorage.setItem("theme", m);
    apply(m);
  };

  return (
    <div role="radiogroup" aria-label="Color theme" className="flex items-center gap-0.5 rounded-full border border-line bg-surface/70 p-0.5 backdrop-blur">
      {MODES.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          aria-label={label}
          title={label}
          onClick={() => choose(m)}
          className={clsx(
            "grid size-7 place-items-center rounded-full transition-colors",
            mode === m ? "bg-surface-2 text-fg shadow-sm" : "text-subtle hover:text-fg",
          )}
        >
          <Icon className="size-3.5" strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
