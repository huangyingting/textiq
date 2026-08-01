import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import type { DocumentListActionPort } from "@/lib/action-ports";
import type { DashboardDocument } from "@/lib/document/list";

import type { DocumentCardData } from "./document-card";
import {
  isCurrentDocumentTrashOperation,
  recordDocumentTrashOperation,
} from "./document-list-async-ordering";

const UNDO_DURATION_MS = 6000;
type DocumentTrashIntent = "delete" | "restore";

export function useOptimisticDocumentTrash(
  documents: DashboardDocument[],
  actions: Pick<DocumentListActionPort, "deleteDocument" | "restoreDocument">,
) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [restored, setRestored] = useState<DashboardDocument[]>([]);
  const [undo, setUndo] = useState<DashboardDocument | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const operationSeqRef = useRef(0);
  const latestOperationByDocumentRef = useRef<Map<string, number>>(new Map());
  const latestIntentByDocumentRef = useRef<Map<string, DocumentTrashIntent>>(
    new Map(),
  );
  const mutationQueueByDocumentRef = useRef<Map<string, Promise<void>>>(
    new Map(),
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const latestOperations = latestOperationByDocumentRef.current;
    const latestIntents = latestIntentByDocumentRef.current;
    const mutationQueues = mutationQueueByDocumentRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      latestOperations.clear();
      latestIntents.clear();
      mutationQueues.clear();
    };
  }, [clearTimer]);

  const enqueueMutation = useCallback(
    (documentId: string, mutation: () => Promise<void>): Promise<void> => {
      const previous = mutationQueueByDocumentRef.current.get(documentId);
      const current = previous
        ? previous.catch(() => undefined).then(mutation)
        : Promise.resolve().then(mutation);
      mutationQueueByDocumentRef.current.set(documentId, current);
      const clearCurrent = () => {
        if (mutationQueueByDocumentRef.current.get(documentId) === current) {
          mutationQueueByDocumentRef.current.delete(documentId);
        }
      };
      void current.then(clearCurrent, clearCurrent);
      return current;
    },
    [],
  );

  const claimIntent = useCallback(
    (documentId: string, intent: DocumentTrashIntent): boolean => {
      if (latestIntentByDocumentRef.current.get(documentId) === intent) {
        return false;
      }
      latestIntentByDocumentRef.current.set(documentId, intent);
      return true;
    },
    [],
  );

  const releaseIntent = useCallback(
    (documentId: string, intent: DocumentTrashIntent, operationSeq: number) => {
      if (
        isCurrentDocumentTrashOperation(
          latestOperationByDocumentRef.current,
          documentId,
          operationSeq,
        ) &&
        latestIntentByDocumentRef.current.get(documentId) === intent
      ) {
        latestIntentByDocumentRef.current.delete(documentId);
      }
    },
    [],
  );

  const handleDelete = useCallback(
    (data: DocumentCardData) => {
      if (!claimIntent(data.id, "delete")) return;
      const full = documents.find((document) => document.id === data.id);
      const stash: DashboardDocument = full
        ? { ...full, title: data.title }
        : {
            ...data,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            tags: [],
          };
      setRemovedIds((prev) => new Set(prev).add(data.id));
      setRestored((prev) => prev.filter((item) => item.id !== data.id));
      setUndo(stash);
      setErrorMessage(null);
      const operationSeq = recordDocumentTrashOperation(
        latestOperationByDocumentRef.current,
        data.id,
        operationSeqRef.current,
      );
      operationSeqRef.current = operationSeq;
      clearTimer();
      timerRef.current = setTimeout(() => setUndo(null), UNDO_DURATION_MS);
      startTransition(async () => {
        try {
          await enqueueMutation(data.id, () => actions.deleteDocument(data.id));
        } catch {
          if (
            !mountedRef.current ||
            !isCurrentDocumentTrashOperation(
              latestOperationByDocumentRef.current,
              data.id,
              operationSeq,
            )
          ) {
            return;
          }
          setRemovedIds((prev) => {
            const next = new Set(prev);
            next.delete(data.id);
            return next;
          });
          setRestored((prev) => [
            stash,
            ...prev.filter((item) => item.id !== data.id),
          ]);
          setUndo((current) => (current?.id === data.id ? null : current));
          setErrorMessage(
            "Could not move the document to trash. It was restored.",
          );
        } finally {
          releaseIntent(data.id, "delete", operationSeq);
        }
      });
    },
    [
      actions,
      claimIntent,
      clearTimer,
      documents,
      enqueueMutation,
      releaseIntent,
    ],
  );

  const handleUndo = useCallback(() => {
    if (!undo) return;
    const data = undo;
    if (!claimIntent(data.id, "restore")) return;
    setUndo(null);
    setErrorMessage(null);
    clearTimer();
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(data.id);
      return next;
    });
    setRestored((prev) => [
      data,
      ...prev.filter((item) => item.id !== data.id),
    ]);
    const operationSeq = recordDocumentTrashOperation(
      latestOperationByDocumentRef.current,
      data.id,
      operationSeqRef.current,
    );
    operationSeqRef.current = operationSeq;
    startTransition(async () => {
      try {
        await enqueueMutation(data.id, () => actions.restoreDocument(data.id));
      } catch {
        if (
          !mountedRef.current ||
          !isCurrentDocumentTrashOperation(
            latestOperationByDocumentRef.current,
            data.id,
            operationSeq,
          )
        ) {
          return;
        }
        setRemovedIds((prev) => new Set(prev).add(data.id));
        setRestored((prev) => prev.filter((item) => item.id !== data.id));
        setErrorMessage("Could not restore the document. It remains in trash.");
      } finally {
        releaseIntent(data.id, "restore", operationSeq);
      }
    });
  }, [actions, claimIntent, undo, clearTimer, enqueueMutation, releaseIntent]);

  const base = documents.filter((document) => !removedIds.has(document.id));
  const baseIds = new Set(base.map((document) => document.id));
  const extra = restored.filter(
    (item) => !baseIds.has(item.id) && !removedIds.has(item.id),
  );

  return {
    combinedDocuments: [...extra, ...base],
    removedIds,
    undo,
    errorMessage,
    handleDelete,
    handleUndo,
  };
}
