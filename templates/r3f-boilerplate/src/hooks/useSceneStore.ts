import { create } from "zustand";

/**
 * Single source of truth for scene state. Pattern:
 *   - Don't put refs to Three objects here; keep those at component scope.
 *   - Put scalars / booleans / "what should be visible" only.
 *   - Subscribe with a selector to avoid re-rendering unrelated components.
 */
interface SceneState {
  showGltf: boolean;
  setShowGltf: (v: boolean) => void;
  selectedId: string | null;
  setSelected: (id: string | null) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  showGltf: false,
  setShowGltf: (v) => set({ showGltf: v }),
  selectedId: null,
  setSelected: (id) => set({ selectedId: id }),
}));
