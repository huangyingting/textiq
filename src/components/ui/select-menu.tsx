"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { FOCUS_RING, MENU_CHROME, cx } from "./tokens";
import { Tooltip } from "./tooltip";

const MENU_GAP = 8;
const VIEWPORT_INSET = 8;

export type SelectMenuOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Optional trailing keyboard-shortcut chip (compact-list spec). */
  shortcut?: ReactNode;
};

export type SelectMenuProps = {
  value: string;
  options: readonly SelectMenuOption[];
  onChange: (value: string) => void;
  "aria-label": string;
  buttonClassName?: string;
  menuClassName?: string;
  placeholder?: ReactNode;
  showSelectedLabel?: boolean;
  showChevron?: boolean;
  showCheck?: boolean;
  scrollable?: boolean;
  textSize?: "xs" | "sm";
  align?: "start" | "center" | "end";
  anchor?: "trigger" | "toolbar";
  /**
   * Visual style of the trigger. `ghost` (default) is a compact borderless
   * button for toolbars; `field` renders a full-width bordered form control
   * that matches text/number inputs in the inspector panels.
   */
  variant?: "ghost" | "field";
  onOpenChange?: (open: boolean) => void;
  tooltipLabel?: ReactNode;
  triggerIcon?: ReactNode;
};

export function SelectMenu({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  buttonClassName,
  menuClassName,
  placeholder = "Select",
  showSelectedLabel = true,
  showChevron = true,
  showCheck = true,
  scrollable = true,
  textSize = "xs",
  align = "start",
  anchor = "trigger",
  variant = "ghost",
  onOpenChange,
  tooltipLabel,
  triggerIcon,
}: SelectMenuProps) {
  const buttonId = useId();
  const listboxId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const active = options[activeIndex];
  const activeId = active ? `${listboxId}-${active.value}` : undefined;
  const displayIcon = triggerIcon ?? selected?.icon;
  const triggerTextClass = textSize === "sm" ? "text-sm" : "text-xs";
  const optionTextClass = textSize === "sm" ? "text-sm" : "text-xs";
  const descriptionTextClass = textSize === "sm" ? "text-xs" : "text-[11px]";
  const menuPosition = anchor === "toolbar" ? "fixed" : "absolute";
  const [coords, setCoords] = useState({ top: -1000, left: -1000, width: 0 });

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const enabledIndexFrom = useCallback(
    (start: number, delta: 1 | -1) => {
      if (options.length === 0) return -1;
      for (let offset = 0; offset < options.length; offset += 1) {
        const next = (start + offset * delta + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return -1;
    },
    [options],
  );

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    onOpenChangeRef.current?.(false);
    if (restoreFocus) {
      buttonRef.current?.focus();
    }
  }, []);

  const selectIndex = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      closeMenu(true);
    },
    [closeMenu, onChange, options],
  );

  const selectActiveOption = useCallback(() => {
    selectIndex(activeIndex);
  }, [activeIndex, selectIndex]);

  const openMenu = () => {
    setActiveIndex(
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : Math.max(0, enabledIndexFrom(0, 1)),
    );
    setOpen(true);
    onOpenChangeRef.current?.(true);
  };

  const reposition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const buttonRect = button.getBoundingClientRect();
    const anchorEl =
      anchor === "toolbar"
        ? ((button.closest(
            '[data-stage-floating-toolbar="true"]',
          ) as HTMLElement | null) ?? button)
        : button;
    const anchorRect = anchorEl.getBoundingClientRect();
    const menuWidth = Math.max(
      buttonRect.width,
      menuRef.current?.offsetWidth ?? 0,
    );
    const preferredLeft =
      align === "center"
        ? anchorRect.left + anchorRect.width / 2 - menuWidth / 2
        : align === "end"
          ? anchorRect.right - menuWidth
          : anchorRect.left;
    const maxLeft = Math.max(
      VIEWPORT_INSET,
      window.innerWidth - menuWidth - VIEWPORT_INSET,
    );
    const viewportLeft = Math.min(
      Math.max(preferredLeft, VIEWPORT_INSET),
      maxLeft,
    );
    setCoords({
      top:
        anchorRect.bottom +
        MENU_GAP +
        (menuPosition === "absolute" ? window.scrollY : 0),
      left: viewportLeft + (menuPosition === "absolute" ? window.scrollX : 0),
      width: buttonRect.width,
    });
  }, [align, anchor, menuPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    if (menuPosition === "fixed") {
      window.addEventListener("scroll", reposition, true);
    }
    return () => {
      window.removeEventListener("resize", reposition);
      if (menuPosition === "fixed") {
        window.removeEventListener("scroll", reposition, true);
      }
    };
  }, [enabledIndexFrom, menuPosition, open, reposition, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      onOpenChangeRef.current?.(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const handleButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      selectActiveOption();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      onOpenChangeRef.current?.(true);
      if (open) {
        setActiveIndex((current) => enabledIndexFrom(current + direction, 1));
        return;
      }
      const selectedEnabled =
        selectedIndex >= 0 && !options[selectedIndex]?.disabled;
      setActiveIndex(
        enabledIndexFrom(selectedEnabled ? selectedIndex : 0, direction),
      );
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectActiveOption();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        enabledIndexFrom(current + (event.key === "ArrowDown" ? 1 : -1), 1),
      );
    }
  };

  const trigger = (
    <button
      ref={buttonRef}
      id={buttonId}
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      onClick={() => {
        if (open) {
          setOpen(false);
          onOpenChangeRef.current?.(false);
        } else {
          openMenu();
        }
      }}
      onKeyDown={handleButtonKeyDown}
      className={cx(
        variant === "field"
          ? "flex h-auto w-full items-center justify-between gap-1.5 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-[13px] font-normal text-ds-text-primary transition-colors hover:bg-ds-state-hover"
          : cx(
              "inline-flex h-7 max-w-40 items-center gap-1.5 rounded-ds-sm px-2 font-medium text-ds-text-primary outline-none transition-colors hover:bg-ds-state-hover aria-expanded:bg-ds-state-active",
              triggerTextClass,
            ),
        variant === "field" ? FOCUS_RING : undefined,
        buttonClassName,
      )}
    >
      {displayIcon ? <span className="shrink-0">{displayIcon}</span> : null}
      {showSelectedLabel ? (
        <span
          className={cx(
            "min-w-0 truncate",
            variant === "field" ? "flex-1 text-left" : undefined,
          )}
        >
          {selected?.label ?? placeholder}
        </span>
      ) : null}
      {showChevron ? (
        <ChevronDown
          size={13}
          aria-hidden="true"
          className="shrink-0 text-ds-text-muted"
        />
      ) : null}
    </button>
  );

  return (
    <>
      {tooltipLabel ? (
        <Tooltip label={tooltipLabel} side="bottom">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {open && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={menuRef}
              id={listboxId}
              data-floating-panel="true"
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-labelledby={buttonId}
              aria-activedescendant={activeId}
              onKeyDown={handleMenuKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerMove={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseMove={(event) => event.stopPropagation()}
              style={{
                top: coords.top,
                left: coords.left,
                minWidth: coords.width,
              }}
              className={cx(
                menuPosition === "fixed" ? "fixed" : "absolute",
                "z-tooltip p-1",
                scrollable ? "max-h-72 overflow-y-auto" : "overflow-visible",
                MENU_CHROME,
                menuClassName,
              )}
            >
              {options.map((option, index) => {
                const selectedOption = option.value === value;
                const activeOption = index === activeIndex;
                return (
                  <li
                    key={option.value}
                    id={`${listboxId}-${option.value}`}
                    role="option"
                    aria-selected={selectedOption}
                  >
                    <button
                      type="button"
                      disabled={option.disabled}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectIndex(index)}
                      className={cx(
                        "flex min-h-7 w-full items-center gap-1.5 rounded-ds-sm py-1 pr-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40",
                        showCheck ? "pl-1" : "pl-2",
                        optionTextClass,
                        selectedOption
                          ? "bg-ds-state-selected text-ds-text-primary"
                          : activeOption
                            ? "bg-ds-state-hover text-ds-text-primary"
                            : "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
                        FOCUS_RING,
                      )}
                    >
                      {showCheck ? (
                        <span className="flex w-4 shrink-0 items-center justify-center text-ds-accent">
                          {selectedOption ? (
                            <Check
                              size={12}
                              strokeWidth={2.5}
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      ) : null}
                      {option.icon ? (
                        <span className="shrink-0">{option.icon}</span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description ? (
                          <span
                            className={cx(
                              "block truncate font-normal text-ds-text-muted",
                              descriptionTextClass,
                            )}
                          >
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {option.shortcut ? (
                        <span className="shrink-0 rounded-ds-sm border border-ds-border-subtle bg-ds-surface-sunken px-[5px] py-px font-mono text-[10px] text-ds-text-muted">
                          {option.shortcut}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
