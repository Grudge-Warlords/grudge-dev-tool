import { hasAffirmativePromptMatch } from "./promptedMotionIntent";

/** Literal scope for the local character author. Bone edits must never become mesh moves. */
export function characterRefinementActions(prompt: string) {
  const match = (pattern: RegExp) => hasAffirmativePromptMatch(prompt, pattern);
  const rigEdit = match(/\b(?:move|shift|reposition|adjust)\b[^.;]{0,80}\b(?:bone|joint)\b/i);
  return {
    unify: match(/\b(?:smooth|smoothed|smoothing|unify|unified|seamless|remesh)\b|\b(?:merge|fuse)\b[^.;]{0,50}\b(?:body|skin|parts|surface)\b/i),
    rig: !rigEdit && match(/\b(?:add|create|build|fit|bind|insert|apply)\b[^.;]{0,100}\b(?:skeleton|rig|bone|bones|skin binding)\b|\bbind\b[^.;]{0,40}\bskin\b/i),
    rigEdit,
  };
}

export function isCharacterRefinementPrompt(prompt: string) {
  const action = characterRefinementActions(prompt);
  return action.unify || action.rig || action.rigEdit || /^(?:please\s+)?(?:animate|idle|paint|texture|retexture|colou?r)\b/i.test(prompt);
}
