export interface TransformSnapshot {
  uuid: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export class TransformHistory {
  private undoStack: TransformSnapshot[] = [];
  private redoStack: TransformSnapshot[] = [];
  private readonly limit: number;

  constructor(limit = 64) {
    this.limit = limit;
  }

  push(snap: TransformSnapshot): void {
    this.undoStack.push(snap);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): TransformSnapshot | null {
    if (!this.undoStack.length) return null;
    const snap = this.undoStack.pop()!;
    this.redoStack.push(snap);
    return snap;
  }

  redo(): TransformSnapshot | null {
    if (!this.redoStack.length) return null;
    const snap = this.redoStack.pop()!;
    this.undoStack.push(snap);
    return snap;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}