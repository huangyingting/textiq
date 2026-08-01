"use client";

import { useCallback, useEffect, useRef } from "react";

type FormAction = (payload: FormData) => void;

/**
 * Claims a React form-action dispatch synchronously, before `useActionState`
 * can queue repeated same-turn submissions. The claim is released only after
 * an observed pending cycle settles, unless the result is terminal and the
 * owning surface is expected to navigate or unmount.
 */
export function useOwnedFormAction({
  action,
  isPending,
  terminal = false,
}: {
  action: FormAction;
  isPending: boolean;
  terminal?: boolean;
}) {
  const submissionInFlightRef = useRef(false);
  const pendingObservedRef = useRef(false);

  useEffect(() => {
    if (isPending) {
      pendingObservedRef.current = true;
      return;
    }
    if (!pendingObservedRef.current || terminal) return;

    pendingObservedRef.current = false;
    submissionInFlightRef.current = false;
  }, [isPending, terminal]);

  useEffect(
    () => () => {
      submissionInFlightRef.current = false;
      pendingObservedRef.current = false;
    },
    [],
  );

  const guardedAction = useCallback(
    (payload: FormData) => {
      if (submissionInFlightRef.current) return;

      submissionInFlightRef.current = true;
      try {
        action(payload);
      } catch (error) {
        submissionInFlightRef.current = false;
        throw error;
      }
    },
    [action],
  );

  const ownsSubmission = useCallback(() => submissionInFlightRef.current, []);

  return { guardedAction, ownsSubmission };
}
