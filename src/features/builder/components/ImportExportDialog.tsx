import { useEffect, useId, useRef, useState } from "react";
import { ClipboardIcon, XIcon } from "../../../components/icons";
import {
  GHOST_ICON_BUTTON,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
} from "../../../lib/glass";
import type { UnmatchedLine } from "../decklistText";

export interface ImportExportDialogProps {
  open: boolean;
  /** Canonical text of the current deck, shown as the starting value. */
  deckText: string;
  /** Apply pasted text as the new deck; resolves the lines against the card
      catalog (async), fulfilling with any it couldn't match and REJECTING on
      an api/network failure (nothing is applied then). */
  onImport: (text: string) => Promise<UnmatchedLine[]>;
  onClose: () => void;
}

const PRIMARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-accent/80 px-4 py-2 text-sm font-semibold text-zinc-950 ring-1 ring-inset ring-white backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-accent/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

/** Import/export the decklist as plain text. The textarea starts with the
    current deck (for export/copy); editing + Import replaces the deck and
    reports any unrecognised lines.

    Built on a native `<dialog>` driven by `open` (mirrors BackToMenu): the
    browser gives focus-move-in, focus trapping, Escape-to-dismiss and focus
    restoration for free, so it renders in the top layer with no portal. */
export function ImportExportDialog({ open, deckText, onImport, onClose }: ImportExportDialogProps) {
  const [text, setText] = useState(deckText);
  const [copied, setCopied] = useState(false);
  const [unmatched, setUnmatched] = useState<UnmatchedLine[] | null>(null);
  // Import runs against the catalog api — a busy flag guards double-submits
  // and a failed flag reports an api/network error (distinct from unmatched
  // lines, which are a SUCCESSFUL import's leftovers).
  const [importing, setImporting] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Reset to the current deck ONLY on the closed→open transition (the
      // `!dialog.open` guard) — so a later Import, which changes `deckText`,
      // doesn't immediately wipe the "imported"/unmatched feedback.
      setText(deckText);
      setUnmatched(null);
      setCopied(false);
      setImportFailed(false);
      textareaRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, deckText]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions / insecure context) — select the text so
      // the user can copy it manually.
      textareaRef.current?.select();
    }
  };

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportFailed(false);
    setUnmatched(null);
    try {
      setUnmatched(await onImport(text));
    } catch {
      // The catalog lookup failed (offline, api down) — nothing was applied.
      setImportFailed(true);
    } finally {
      setImporting(false);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape; this onClick only adds backdrop click-to-dismiss for pointer users.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        // Escape mid-import would dismiss the dialog while the deck is still
        // about to be replaced — and the open-effect reset would wipe the
        // unmatched report. Hold the dialog until the import settles.
        if (importing) e.preventDefault();
      }}
      onClick={(e) => {
        // A click whose target is the dialog itself landed on the ::backdrop.
        // Ignored while importing — same reason as the cancel guard above.
        if (e.target === dialogRef.current && !importing) onClose();
      }}
      className="m-auto border-0 bg-transparent p-0 text-white [&::backdrop]:bg-black/60 [&::backdrop]:backdrop-blur-sm"
    >
      <div className={`w-[min(32rem,calc(100vw-2rem))] ${GLASS_DIALOG_PANEL}`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-white/90">
            Import / Export decklist
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={importing}
            className={`flex h-8 w-8 disabled:cursor-default disabled:opacity-60 ${GHOST_ICON_BUTTON}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-2 text-xs text-white/55">
          Paste a list as <span className="text-white/80">4 Card Name SET 123</span> and import, or
          copy the current deck.
        </p>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Decklist text"
          className="h-64 w-full resize-none rounded-xl bg-black/30 p-3 font-mono text-xs leading-relaxed text-white/85 outline-none ring-1 ring-inset ring-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
        />

        {/* <output> carries an implicit role=status + polite live region, so the
            import outcome is announced to assistive tech. */}
        <output className="block">
          {importFailed && (
            <p className="mt-3 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-200/90 ring-1 ring-inset ring-red-400/25">
              Import failed — couldn't reach the card catalog. Nothing was changed; try again.
            </p>
          )}
          {unmatched && unmatched.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200/90 ring-1 ring-inset ring-amber-400/25">
              <p className="font-semibold">Couldn't find {unmatched.length} card(s):</p>
              <p className="mt-0.5 text-amber-100/70">
                {unmatched.map((u) => `${u.quantity} ${u.name}`).join(", ")}
              </p>
            </div>
          )}
          {unmatched && unmatched.length === 0 && (
            <p className="mt-3 text-xs text-[#7fe39c]">Imported — every card was found.</p>
          )}
        </output>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={handleCopy} className={GLASS_DIALOG_GHOST_BUTTON}>
            <span className="inline-flex items-center gap-1.5">
              <ClipboardIcon className="h-4 w-4" />
              {copied ? "Copied" : "Copy"}
            </span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className={`${GLASS_DIALOG_GHOST_BUTTON} disabled:cursor-default disabled:opacity-60`}
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className={`${PRIMARY} disabled:cursor-default disabled:opacity-60`}
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
