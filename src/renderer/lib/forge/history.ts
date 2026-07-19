/**
 * Forge editor history — undo / redo for transforms, materials, and tool ops.
 *
 * Convention: stacks hold *restorable previous states*.
 * - Before an action, push the current state onto undo.
 * - Undo: capture live state → redo, apply popped undo entry.
 * - Redo: capture live state → undo, apply popped redo entry.
 */

export type EditorToolId =
  | "select"
  | "translate"
  | "rotate"
  | "scale"
  | "paint"
  | "fill"
  | "fix-mesh"
  | "fix-terrain"
  | "smooth"
  | "ground";

export interface TransformSnapshot {
  kind: "transform";
  uuid: string;
  position: [number, number, number];
  rotation: [number, number, number]; // degrees
  scale: [number, number, number];
}

export interface MaterialSnapshot {
  kind: "material";
  uuid: string;
  color: number;
  metalness?: number;
  roughness?: number;
}

export interface GeometrySnapshot {
  kind: "geometry";
  uuid: string;
  positions: number[];
  normals: number[] | null;
}

export type HistoryEntry = TransformSnapshot | MaterialSnapshot | GeometrySnapshot;

export class TransformHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly limit: number;
  private dragBefore: TransformSnapshot | null = null;

  constructor(limit = 128) {
    this.limit = limit;
  }

  /** Record state *before* a mutation. Clears redo. */
  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  beginDrag(snap: TransformSnapshot): void {
    this.dragBefore = snap;
  }

  endDrag(): boolean {
    if (!this.dragBefore) return false;
    this.push(this.dragBefore);
    this.dragBefore = null;
    return true;
  }

  cancelDrag(): void {
    this.dragBefore = null;
  }

  /**
   * Pop undo entry. Caller must:
   * 1. Snapshot live state
   * 2. pushLiveToRedo(live)
   * 3. Apply the returned entry
   */
  popUndo(): HistoryEntry | null {
    return this.undoStack.pop() ?? null;
  }

  popRedo(): HistoryEntry | null {
    return this.redoStack.pop() ?? null;
  }

  pushLiveToRedo(live: HistoryEntry): void {
    this.redoStack.push(live);
    if (this.redoStack.length > this.limit) this.redoStack.shift();
  }

  pushLiveToUndo(live: HistoryEntry): void {
    this.undoStack.push(live);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  /** @deprecated use popUndo + pushLiveToRedo */
  undo(): HistoryEntry | null {
    return this.popUndo();
  }

  /** @deprecated use popRedo + pushLiveToUndo */
  redo(): HistoryEntry | null {
    return this.popRedo();
  }

  recordRedoApplied(entry: HistoryEntry): void {
    this.pushLiveToUndo(entry);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.dragBefore = null;
  }
}
