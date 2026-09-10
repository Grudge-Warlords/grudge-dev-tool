/** Separate a trailing app handoff from the instruction owned by creation.submit. */
export function appCreationPrompt(prompt: string): { creation: string; continuation: string } {
  const text = prompt.replace(/^\s*(?:open|go to)\s+prompt\s+to\s+3d\s*[,.;]\s*/i, "");
  const boundary = /(?:[,.;]\s*(?:and\s+)?(?:then\s+)?|\s+(?:and\s+then|and|then)\s+)(?=(?:open|show|navigate|go\s+to|edit\s+(?:it|the\s+(?:current|selected)\s+(?:model|asset))\s+in|(?:move|send|take)\s+(?:(?:the|this|current|selected|completed)\s+)*(?:it|character|model|asset)\s+to\s+(?:skeleton\s+studio|forge))\b)/i.exec(text);
  const creation = (boundary ? text.slice(0, boundary.index) : text).trim();
  let continuation = boundary ? text.slice(boundary.index + boundary[0].length).trim() : "";
  continuation = continuation.replace(/^(?:open|edit)\s+(?:it|this|the\s+(?:model|asset))\s+in\s+Forge\b/i, "Open the current model in Forge");
  continuation = continuation.replace(/^(?:move|send|take)\s+(?:(?:the|this|current|selected|completed)\s+)*(?:it|character|model|asset)\s+to\s+(skeleton\s+studio|forge)(?:\s+(?:once|when)\s+(?:completed|complete|finished))?[.!]?$/i, (_, tool: string) => `Open the current model in ${/^skeleton/i.test(tool) ? "Skeleton Studio" : "Forge"}`);
  return { creation, continuation };
}

/** Error reasons are observed app results, never new requirements invented by a planner. */
export function creationFailureReason(status: string[]): string | undefined {
  return status.find(s => /^Prompt did not complete|^Attempt failed/i.test(s))?.slice(0, 600);
}

/** Geometry/surface revisions use the retained creation runner; rig controls stay in Skeleton Studio. */
export function isSkeletonModelRevision(prompt: string): boolean {
  const {creation} = appCreationPrompt(prompt);
  return /^(?:please\s+)?(?:paint|textur\w*|retexture|colou?r|resize|scale|duplicate|rename|remove|clear|move|rotate|make|add)\b/i.test(creation) &&
    !/\b(bone|bones|joint|joints|rig|skeleton|pose|bind|retarget|extract|clip|clips|camera|viewport|marker|markers)\b/i.test(creation);
}

export function skeletonRevisionContinuation(prompt: string): string {
  return `Open Prompt to 3D, ${prompt}${appCreationPrompt(prompt).continuation ? "" : ", then open the current model in Skeleton Studio"}`;
}
