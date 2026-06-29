import { useControls } from "leva";

/**
 * Dev-only knobs. Wrap anything you want a designer to twiddle. The leva panel
 * shows up in the top-right; hidden in production with `hidden: import.meta.env.PROD`.
 */
export function useDevControls() {
  const controls = useControls(
    "Engine",
    {
      exposure: { value: 1.0, min: 0.1, max: 4.0, step: 0.05 },
      postFx:   { value: true },
      stats:    { value: false },
    },
    { hidden: import.meta.env.PROD },
  );
  return controls;
}
