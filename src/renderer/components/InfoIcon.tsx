import React, { useState } from "react";
import type { LucideIcon } from "lucide-react";

/** Keep chrome stable when a remote icon is loading or unavailable. */
export default function InfoIcon({
  src,
  fallback: Fallback,
  size = 16,
}: {
  src: string;
  fallback: LucideIcon;
  size?: number;
}) {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = loadedSource === src && failedSource !== src;

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center rounded-sm"
      style={{ width: size, height: size }}
    >
      <Fallback size={size} style={{ visibility: showImage ? "hidden" : "visible" }} />
      {failedSource !== src && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 rounded-sm"
          style={{ objectFit: "contain", opacity: showImage ? 1 : 0 }}
          onLoad={() => setLoadedSource(src)}
          // Remove a failed image; assigning another remote src here can loop.
          onError={() => setFailedSource(src)}
        />
      )}
    </span>
  );
}
