/** Separate a trailing app handoff from the instruction owned by creation.submit. */
export function appCreationPrompt(prompt: string): { creation: string; continuation: string } {
  const text = prompt.replace(/^\s*(?:open|go to)\s+prompt\s+to\s+3d\s*[,.;]\s*/i, "");
  const boundary = /(?:[,.;]\s*(?:and\s+)?(?:then\s+)?|\s+(?:and\s+then|and|then)\s+)(?=(?:open|show|navigate|go\s+to|edit\s+(?:it|the\s+(?:current|selected)\s+(?:model|asset))\s+in)\b)/i.exec(text);
  const creation = (boundary ? text.slice(0, boundary.index) : text).trim();
  let continuation = boundary ? text.slice(boundary.index + boundary[0].length).trim() : "";
  continuation = continuation.replace(/^(?:open|edit)\s+(?:it|this|the\s+(?:model|asset))\s+in\s+Forge\b/i, "Open the current model in Forge");
  return { creation, continuation };
}
