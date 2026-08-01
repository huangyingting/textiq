export type PendingVisualPickerRequest<TValue> = {
  promise: Promise<TValue | undefined>;
  resolve: (value: TValue | undefined) => void;
};

export type PendingVisualPickerRequestRef<TValue> = {
  current: PendingVisualPickerRequest<TValue> | null;
};

export function createPendingVisualPickerRequest<
  TValue,
>(): PendingVisualPickerRequest<TValue> {
  let resolve!: (value: TValue | undefined) => void;
  const promise = new Promise<TValue | undefined>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

export function settlePendingVisualPickerRequest<TValue>(
  requestRef: PendingVisualPickerRequestRef<TValue>,
  request: PendingVisualPickerRequest<TValue>,
  value: TValue | undefined,
): boolean {
  if (requestRef.current !== request) return false;
  requestRef.current = null;
  request.resolve(value);
  return true;
}
