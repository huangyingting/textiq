"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Command, Search, X } from "lucide-react";

import { IconButton } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import {
  filterSlideCommandPaletteCommands,
  type SlideCommandPaletteCommand,
} from "@/lib/presentation/slide-command-palette";

export function SlideCommandPalette({
  open,
  commands,
  isMac,
  onClose,
  onRun,
}: {
  open: boolean;
  commands: readonly SlideCommandPaletteCommand[];
  isMac: boolean;
  onClose: () => void;
  onRun: (command: SlideCommandPaletteCommand) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = useMemo(
    () => filterSlideCommandPaletteCommands(commands, query),
    [commands, query],
  );
  const boundedActiveIndex = Math.min(
    Math.max(0, activeIndex),
    Math.max(0, results.length - 1),
  );
  const activeCommand = results[boundedActiveIndex];
  const shortcutHint = isMac ? "⌘K" : "Ctrl+K";

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function runCommand(command: SlideCommandPaletteCommand | undefined) {
    if (!command || command.disabledReason) return;
    onRun(command);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        results.length === 0 ? 0 : (current + 1) % results.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        results.length === 0
          ? 0
          : (current - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runCommand(activeCommand);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="slide-command-palette-title"
      className="max-w-2xl p-0"
    >
      <div className="border-b border-ds-border-subtle p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-ds-md bg-ds-accent-surface text-ds-accent-text">
              <Command size={15} aria-hidden="true" />
            </span>
            <div>
              <h2
                id="slide-command-palette-title"
                className="text-sm font-semibold text-ds-text-primary"
              >
                Command palette
              </h2>
              <p className="text-xs text-ds-text-muted">
                Search valid slide editor actions. {shortcutHint}
              </p>
            </div>
          </div>
          <IconButton
            aria-label="Close command palette"
            size="sm"
            variant="plain"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <label className="relative block">
          <span className="sr-only">Search commands</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-text-muted"
            size={15}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="slide-command-palette-results"
            aria-activedescendant={
              activeCommand
                ? `slide-command-palette-option-${activeCommand.id}`
                : undefined
            }
            placeholder="Search commands, panels, inserts, export…"
            className={cx(
              "h-10 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface pl-9 pr-3 text-sm text-ds-text-primary placeholder:text-ds-text-muted",
              FOCUS_RING,
            )}
          />
        </label>
      </div>
      <div
        id="slide-command-palette-results"
        role="listbox"
        aria-label="Slide editor commands"
        className="max-h-[min(60vh,28rem)] overflow-y-auto p-2"
      >
        {results.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-ds-text-muted">
            No commands match “{query}”.
          </p>
        ) : (
          results.map((command, index) => {
            const active = index === boundedActiveIndex;
            const disabled = command.disabledReason !== undefined;
            return (
              <button
                key={command.id}
                id={`slide-command-palette-option-${command.id}`}
                type="button"
                role="option"
                aria-selected={active}
                aria-disabled={disabled}
                disabled={disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
                className={cx(
                  "flex w-full items-start justify-between gap-3 rounded-ds-md px-3 py-2.5 text-left transition-colors",
                  active
                    ? "bg-ds-accent-surface text-ds-text-primary"
                    : "text-ds-text-secondary hover:bg-ds-state-hover",
                  disabled ? "cursor-not-allowed opacity-50" : "",
                  FOCUS_RING,
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {command.label}
                    </span>
                    <span className="shrink-0 rounded-ds-sm bg-ds-surface-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted">
                      {command.section}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ds-text-muted">
                    {command.disabledReason ?? command.description}
                  </span>
                </span>
                {command.shortcut ? (
                  <kbd className="shrink-0 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-1.5 py-0.5 text-[11px] font-medium text-ds-text-muted">
                    {command.shortcut}
                  </kbd>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </Dialog>
  );
}
