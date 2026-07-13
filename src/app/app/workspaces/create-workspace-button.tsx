"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button, Dialog, FIELD_CONTROL } from "@/components/ui";

import { createWorkspace } from "./actions";

export type CreateWorkspaceViewProps = {
  error: string | null;
  action: (payload: FormData) => void;
  isPending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
};

/**
 * Pure state -> markup decision for {@link CreateWorkspaceButton} (issue
 * #1957). Given the current `useActionState` result, the dialog's open flag,
 * and its open/close callback, decides the trigger button label, whether the
 * validation error paragraph renders (a path-like value signals a pending
 * redirect rather than a validation error, so it is never shown as text),
 * and the submit button's pending label/disabled state. Extracted from the
 * component body — including the submit button, which previously read its
 * own pending flag via `useFormStatus()` — so the same `isPending` value
 * `useActionState` already returns can drive both the effect and the
 * markup without a second, hook-coupled read of form status.
 */
export function renderCreateWorkspaceView({
  error,
  action,
  isPending,
  open,
  onOpenChange,
  className,
  children = "New workspace",
}: CreateWorkspaceViewProps): ReactNode {
  return (
    <>
      <Button
        variant="solid"
        size="lg"
        className={className}
        onClick={() => onOpenChange(true)}
      >
        {children}
      </Button>

      <Dialog
        open={open}
        onClose={() => onOpenChange(false)}
        aria-labelledby="create-workspace-title"
        className="max-w-sm"
      >
        <form action={action} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2
              id="create-workspace-title"
              className="text-lg font-semibold text-ds-text-primary"
            >
              Create workspace
            </h2>
            <p className="text-sm text-ds-text-secondary">
              A workspace lets you collaborate with your team on documents.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="name"
              className="text-sm font-medium text-ds-text-primary"
            >
              Workspace name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoFocus
              placeholder="Marketing team"
              className={`${FIELD_CONTROL} h-10 px-3`}
            />
            {error && typeof error === "string" && !error.startsWith("/") && (
              <p role="alert" className="text-sm text-ds-danger-text">
                {error}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isPending}
              variant="solid"
              size="lg"
              className="flex-1"
            >
              {isPending ? "Creating..." : "Create"}
            </Button>
            <Button
              variant="subtle"
              size="lg"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CreateWorkspaceButton({
  className,
  children = "New workspace",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [error, action, isPending] = useActionState(createWorkspace, null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (error && error.startsWith("/app/workspaces/")) {
      router.push(error);
    }
  }, [error, router]);

  return renderCreateWorkspaceView({
    error,
    action,
    isPending,
    open,
    onOpenChange: setOpen,
    className,
    children,
  });
}
