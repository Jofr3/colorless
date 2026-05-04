const WIDTHS = [200, 400, 600] as const;
const ASPECT_W = 2.5;
const ASPECT_H = 3.5;

export interface CardImageProps {
  cardId: string;
  renderedWidth: number;
  alt: string;
  priority?: boolean;
  className?: string;
}

function buildSrcSet(id: string, ext: string) {
  return WIDTHS.map((w) => `/cards/${id}-${w}.${ext} ${w}w`).join(", ");
}

export default function CardImage({
  cardId,
  renderedWidth,
  alt,
  priority = false,
  className,
}: CardImageProps) {
  const intrinsicWidth = Math.round(renderedWidth);
  const intrinsicHeight = Math.round(renderedWidth * (ASPECT_H / ASPECT_W));
  const sizes = `${intrinsicWidth}px`;
  return (
    <picture>
      <source type="image/avif" srcSet={buildSrcSet(cardId, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={buildSrcSet(cardId, "webp")} sizes={sizes} />
      <img
        src={`/cards/${cardId}-400.jpg`}
        srcSet={buildSrcSet(cardId, "jpg")}
        sizes={sizes}
        alt={alt}
        width={intrinsicWidth}
        height={intrinsicHeight}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className={className}
        style={{ imageRendering: "auto", display: "block" }}
        draggable={false}
      />
    </picture>
  );
}
