/**
 * The single, shared result shape returned by server actions (issue #144).
 *
 * This discriminated union lets every action return a uniform value, and callers
 * narrow on the `ok` flag while preserving user-facing error messages in
 * production:
 *
 * ```ts
 * const res = await someAction();
 * if (!res.ok) {
 *   showError(res.error);
 *   return;
 * }
 * use(res.data);
 * ```
 *
 * `T` defaults to `void` for actions that succeed without returning a payload.
 */
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string };

/** Builds a successful {@link ActionResult}, optionally carrying a payload. */
export function actionOk(): ActionResult<void>;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T> {
  return { ok: true, data: data as T };
}

/**
 * Builds a failed {@link ActionResult} carrying a user-facing message.
 *
 * Returning (rather than throwing) is what keeps the message visible in
 * production, where Next.js would otherwise mask a thrown server-action error.
 * The generic defaults to `never` so the result is assignable to an
 * `ActionResult<T>` for any success payload `T`.
 */
export function actionError<T = never>(message: string): ActionResult<T> {
  return { ok: false, error: message };
}
