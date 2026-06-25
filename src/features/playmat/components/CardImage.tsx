import { useState } from "react";

const CARD_ASPECT_RATIO = 3.5 / 2.5;

interface CardImageProps {
  imageUrl?: string;
  renderedWidth: number;
  alt: string;
  priority?: boolean;
  className?: string;
}

export function CardImage({
  imageUrl,
  renderedWidth,
  alt,
  priority = false,
  className,
}: CardImageProps) {
  const width = Math.round(renderedWidth);
  const height = Math.round(renderedWidth * CARD_ASPECT_RATIO);
  const loading = priority ? "eager" : "lazy";
  const fetchPriority = priority ? "high" : "auto";
  // Track the URL that failed (not just a boolean) so a later prop change to a
  // different imageUrl re-attempts the load instead of staying on the fallback.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!imageUrl || failedUrl === imageUrl) {
    // No source, or the remote art 404'd / failed CORS — render a neutral,
    // correctly-sized placeholder so layout stays stable instead of showing the
    // browser's broken-image glyph.
    return <div className={className} style={{ width, height, background: "#161621" }} />;
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      width={width}
      height={height}
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
