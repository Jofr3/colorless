import { useState } from "react";

const CARD_ASPECT_RATIO = 3.5 / 2.5;

interface CardImageProps {
  imageUrl?: string;
  alt: string;
  priority?: boolean;
  className?: string;
  /** Fixed-size mode (the playmat): renders explicit width/height attributes so
      layout never shifts as art loads. Provide this OR set `fill`. */
  renderedWidth?: number;
  /** Fluid mode (the deck builder grid): the parent owns the box (e.g. an
      aspect-ratio container) and the image fills it. `className` should carry the
      object-fit + size utilities. */
  fill?: boolean;
}

/** A card image with a graceful fallback: when there's no source, or the remote
    art 404s / fails CORS, it renders a neutral correctly-shaped tile instead of
    the browser's broken-image glyph. Works in two layouts — fixed (px width) for
    the simulator, or `fill` for a responsive grid cell. */
export function CardImage({
  imageUrl,
  renderedWidth,
  alt,
  priority = false,
  className,
  fill = false,
}: CardImageProps) {
  const loading = priority ? "eager" : "lazy";
  const fetchPriority = priority ? "high" : "auto";
  // Track the URL that failed (not just a boolean) so a later prop change to a
  // different imageUrl re-attempts the load instead of staying on the fallback.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Fixed mode sizes the element itself; fluid mode leaves sizing to the parent.
  const sized =
    !fill && renderedWidth !== undefined
      ? { width: Math.round(renderedWidth), height: Math.round(renderedWidth * CARD_ASPECT_RATIO) }
      : undefined;

  if (!imageUrl || failedUrl === imageUrl) {
    return (
      <div
        className={className}
        style={{ ...(sized ?? {}), background: "#161621" }}
        aria-label={alt}
        role="img"
      />
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      width={sized?.width}
      height={sized?.height}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      referrerPolicy="no-referrer"
      className={className}
      style={{ imageRendering: "auto", display: "block" }}
      draggable={false}
      onError={() => setFailedUrl(imageUrl)}
    />
  );
}
