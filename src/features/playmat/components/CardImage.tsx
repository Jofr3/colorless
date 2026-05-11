const CARD_ASPECT_RATIO = 3.5 / 2.5;
const LOCAL_CARD_IMAGE_WIDTHS = [200, 400, 600] as const;
const LOCAL_CARD_FALLBACK_WIDTH = 600;

type LocalCardImageFormat = "avif" | "webp" | "jpg";

interface CardImageProps {
  cardId: string;
  imageUrl?: string;
  renderedWidth: number;
  alt: string;
  priority?: boolean;
  className?: string;
}

function localCardImagePath(cardId: string, width: number, format: LocalCardImageFormat) {
  return `/cards/${cardId}-${width}.${format}`;
}

function localCardSrcSet(cardId: string, format: LocalCardImageFormat) {
  return LOCAL_CARD_IMAGE_WIDTHS.map(
    (width) => `${localCardImagePath(cardId, width, format)} ${width}w`,
  ).join(", ");
}

export function CardImage({
  cardId,
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

  if (imageUrl) {
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

  return (
    <picture>
      <source type="image/avif" srcSet={localCardSrcSet(cardId, "avif")} sizes={`${width}px`} />
      <source type="image/webp" srcSet={localCardSrcSet(cardId, "webp")} sizes={`${width}px`} />
      <img
        src={localCardImagePath(cardId, LOCAL_CARD_FALLBACK_WIDTH, "jpg")}
        srcSet={localCardSrcSet(cardId, "jpg")}
        sizes={`${width}px`}
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
    </picture>
  );
}
