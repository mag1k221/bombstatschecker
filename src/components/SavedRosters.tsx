"use client";

import { Bookmark, BookmarkPlus, Check, X } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { MAX_ROSTER_NAME, parseSavedRosters, removeRoster, SAVED_ROSTERS_KEY, upsertRoster, type SavedRoster } from "@/lib/saved-rosters";

export function SavedRosters({ text, count, onLoad }: { text: string; count: number; onLoad: (text: string) => void }) {
  const [list, setList] = useState<SavedRoster[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setList(parseSavedRosters(localStorage.getItem(SAVED_ROSTERS_KEY)));
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  function persist(next: SavedRoster[]) {
    setList(next);
    try {
      localStorage.setItem(SAVED_ROSTERS_KEY, JSON.stringify(next));
    } catch {
      /* quota or privacy mode */
    }
  }

  function save() {
    const n = name.trim();
    if (!n || count === 0) return;
    persist(upsertRoster(list, { name: n, text, count }));
    setNaming(false);
    setName("");
    setFlash(n);
    setTimeout(() => setFlash(null), 1800);
  }

  const active = list.find((r) => r.text.trim() === text.trim() && text.trim() !== "");

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {list.map((r) => (
        <span
          key={r.name}
          className={clsx(
            "group inline-flex items-center rounded-full border text-[12.5px] transition-colors",
            active?.name === r.name ? "border-accent/40 bg-accent-soft text-accent" : "border-line-strong bg-surface text-fg hover:bg-surface-2",
          )}
        >
          <button
            type="button"
            onClick={() => onLoad(r.text)}
            title={`Load “${r.name}” (${r.count} members)`}
            className="inline-flex items-center gap-1.5 py-1 pr-1 pl-2.5 font-medium"
          >
            <Bookmark className="size-3" aria-hidden />
            {r.name}
            <span className="tnum text-subtle">{r.count}</span>
          </button>
          <button
            type="button"
            onClick={() => persist(removeRoster(list, r.name))}
            aria-label={`Delete saved roster ${r.name}`}
            title="Delete"
            className="mr-1 rounded-full p-0.5 text-subtle hover:bg-surface-2 hover:text-danger"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {naming ? (
        // Not a <form>: this sits inside the main analyze form, and nested forms are invalid.
        <div className="inline-flex items-center gap-1" role="group" aria-label="Save roster">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // don't submit the surrounding analyze form
                save();
              } else if (e.key === "Escape") setNaming(false);
            }}
            maxLength={MAX_ROSTER_NAME}
            placeholder="Roster name"
            aria-label="Name for this roster"
            className="h-7 w-36 rounded-full border border-line-strong bg-surface px-3 text-[12.5px] focus:border-accent focus:outline-none"
          />
          <button type="button" onClick={save} disabled={!name.trim()} className="rounded-full bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-fg disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={() => setNaming(false)} aria-label="Cancel" className="rounded-full p-1 text-subtle hover:bg-surface-2">
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={count === 0}
          onClick={() => {
            setName(active?.name ?? "");
            setNaming(true);
          }}
          title={count === 0 ? "Add some nicknames first" : "Save this roster in your browser"}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[12.5px] font-medium text-muted transition-colors hover:border-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {flash ? <Check className="size-3 text-ok" aria-hidden /> : <BookmarkPlus className="size-3" aria-hidden />}
          {flash ? `Saved “${flash}”` : list.length ? "Save roster" : "Save roster for next time"}
        </button>
      )}
    </div>
  );
}
