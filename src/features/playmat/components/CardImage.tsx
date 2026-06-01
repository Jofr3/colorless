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

  if (!imageUrl) {
    // No source — render a neutral, correctly-sized placeholder so layout
    // stays stable. (Every card in the current data carries a remote imageUrl,
    // so this branch is a safety net rather than a live code path.)
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
      className={className}
      style={{ imageRendering: "auto", display: "block" }}
      draggable={false}
    />
  );
}
