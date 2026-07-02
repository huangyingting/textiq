export interface SingleCommitGestureOptions<T> {
  initialValue: T;
  onPreview: (value: T | null) => void;
  onCommit: (value: T) => void;
  equals?: (a: T, b: T) => boolean;
}

export interface SingleCommitGesture<T> {
  update: (value: T) => void;
  finish: () => void;
}

export function createSingleCommitGesture<T>({
  initialValue,
  onPreview,
  onCommit,
  equals = Object.is,
}: SingleCommitGestureOptions<T>): SingleCommitGesture<T> {
  let latestValue: T | null = null;
  let finished = false;

  return {
    update(value) {
      if (finished) return;
      latestValue = value;
      onPreview(value);
    },
    finish() {
      if (finished) return;
      finished = true;
      if (latestValue !== null && !equals(latestValue, initialValue)) {
        onCommit(latestValue);
      }
      onPreview(null);
    },
  };
}
