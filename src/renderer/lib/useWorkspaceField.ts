import { useCallback, useEffect, useState } from "react";
import { hydrateFromMain, persistWorkspaceField, readMirror, type WorkspaceMirror } from "./workspace";

/** Hydrates from localStorage mirror, syncs from electron-store, persists on change. */
export function useWorkspaceField<K extends keyof WorkspaceMirror>(
  key: K,
  defaultValue: NonNullable<WorkspaceMirror[K]>,
): [NonNullable<WorkspaceMirror[K]>, (value: NonNullable<WorkspaceMirror[K]>) => void] {
  const [value, setValue] = useState<NonNullable<WorkspaceMirror[K]>>(() => {
    const saved = readMirror()[key];
    return (saved != null && saved !== "" ? saved : defaultValue) as NonNullable<WorkspaceMirror[K]>;
  });

  useEffect(() => {
    void hydrateFromMain().then((snap) => {
      const saved = snap?.[key];
      if (saved != null && saved !== "") {
        setValue(saved as NonNullable<WorkspaceMirror[K]>);
      }
    });
  }, [key]);

  const set = useCallback((next: NonNullable<WorkspaceMirror[K]>) => {
    setValue(next);
    void persistWorkspaceField(key, next);
  }, [key]);

  return [value, set];
}