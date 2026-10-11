"use client";

import { FileText, Upload, X } from "lucide-react";
import clsx from "clsx";
import { forwardRef, useId, useRef, useState, type DragEvent } from "react";
import { SavedRosters } from "./SavedRosters";
import { extractNames, formatFromFileName, looksBinary, MAX_FILE_BYTES, MAX_ROSTER_SIZE, type RosterResult } from "@/lib/stats/roster";

interface Props {
  value: string;
  onChange: (v: string) => void;
  roster: RosterResult;
}

export const RosterInput = forwardRef<HTMLTextAreaElement, Props>(function RosterInput({ value, onChange, roster }, ref) {
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [dragging, setDragging] = useState(false);
  const [fileNote, setFileNote] = useState<{ name: string; count: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaId = useId();
  const helpId = useId();

  async function handleFile(file: File) {
    setFileError(null);
    const format = formatFromFileName(file.name);
    if (!format) return setFileError("Use a .txt or .csv file.");
    if (file.size > MAX_FILE_BYTES) return setFileError(`File is larger than ${Math.round(MAX_FILE_BYTES / 1024)} KB.`);
    if (file.size === 0) return setFileError("That file is empty.");
    let text: string;
    try {
      text = await file.text(); // read as plain text only — never executed or rendered as HTML
    } catch {
      return setFileError("Couldn’t read that file.");
    }
    if (looksBinary(text)) return setFileError("That file doesn’t look like plain text.");
    const names = extractNames(text, format).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) return setFileError("No nicknames found in that file.");
    onChange(names.join("\n"));
    setFileNote({ name: file.name.slice(0, 80), count: names.length });
    setMode("paste"); // show the imported list so it can be reviewed and edited
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }

  const unique = roster.members.length;
  const issues = roster.duplicates.length + roster.invalid.length + roster.overflow;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Roster input method" className="inline-flex rounded-full bg-surface-2 p-0.5">
          {(["paste", "upload"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={clsx(
                "whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-all sm:px-3.5",
                mode === m ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              {m === "paste" ? "Type or paste" : "Upload file"}
            </button>
          ))}
        </div>
        <p className="tnum whitespace-nowrap text-[13px] text-muted" aria-live="polite">
          <span className="font-semibold text-fg">{unique}</span> <span className="hidden sm:inline">unique </span>{unique === 1 ? "member" : "members"}
        </p>
      </div>

      {mode === "paste" ? (
        <div>
          <label htmlFor={textareaId} className="sr-only">
            Member nicknames, one per line
          </label>
          <textarea
            id={textareaId}
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={helpId}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            rows={7}
            maxLength={64 * 1024}
            placeholder={"Ashwick\nBrannoc\nCinderfall\n…"}
            className="block w-full resize-y rounded-2xl border border-line-strong bg-surface-2/60 px-4 py-3 font-mono text-[13.5px] leading-6 text-fg placeholder:text-subtle transition-colors focus:border-accent focus:bg-surface focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-accent-soft"
          />
          {fileNote && (
            <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
              <FileText className="size-3.5" aria-hidden />
              Imported {fileNote.count} {fileNote.count === 1 ? "line" : "lines"} from <span className="font-medium text-fg">{fileNote.name}</span>
              <button className="ml-1 rounded-full p-0.5 hover:bg-surface-2" aria-label="Dismiss import note" onClick={() => setFileNote(null)}>
                <X className="size-3" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={clsx(
            "group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed px-6 py-10 text-center transition-all duration-200",
            dragging ? "scale-[1.01] border-accent bg-accent-soft" : "border-line-strong bg-surface-2/50 hover:border-subtle",
          )}
        >
          <div className={clsx("grid size-12 place-items-center rounded-2xl bg-surface shadow-card transition-transform duration-300", dragging && "-translate-y-1")}>
            <Upload className="size-5 text-accent" aria-hidden />
          </div>
          <div>
            <p className="text-[15px] font-medium text-fg">Drop your roster here</p>
            <p className="mt-1 text-[13px] text-muted">
              .txt (one nickname per line) or .csv (a “name”/“nickname” column, or the first column) · up to {MAX_FILE_BYTES / 1024} KB
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded-full border border-line-strong bg-surface px-4 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
          >
            Choose file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <div id={helpId} className="mt-2 min-h-5 text-[12.5px]" aria-live="polite">
        {fileError ? (
          <p className="text-danger">{fileError}</p>
        ) : issues > 0 ? (
          <p className="text-muted">
            {roster.duplicates.length > 0 && <>{roster.duplicates.length} duplicate{roster.duplicates.length > 1 ? "s" : ""} will be ignored. </>}
            {roster.invalid.length > 0 && (
              <span className="text-warn">
                {roster.invalid.length} invalid {roster.invalid.length > 1 ? "entries" : "entry"} skipped ({roster.invalid.slice(0, 3).map((i) => `“${i.name}”`).join(", ")}
                {roster.invalid.length > 3 ? "…" : ""}).{" "}
              </span>
            )}
            {roster.overflow > 0 && <span className="text-warn">Only the first {MAX_ROSTER_SIZE} members will be analyzed.</span>}
          </p>
        ) : (
          <p className="text-subtle">One nickname per line. Matching is exact and case-insensitive — no fuzzy matching.</p>
        )}
      </div>
      <SavedRosters
        text={value}
        count={unique}
        onLoad={(t) => {
          onChange(t);
          setFileNote(null);
          setMode("paste");
        }}
      />
    </div>
  );
});
