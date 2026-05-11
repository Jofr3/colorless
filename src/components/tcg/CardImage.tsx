const ASPECT_W = 2.5;
const ASPECT_H = 3.5;
const CARD_IMAGE_WIDTH = 600;

export interface CardImageProps {
  cardId: string;
  imageUrl?: string;
  renderedWidth: number;
  alt: string;
  priority?: boolean;
  className?: string;
}

export default function CardImage({
  cardId,
  imageUrl,
  renderedWidth,
  alt,
  priority = false,
  className,
}: CardImageProps) {
  const intrinsicWidth = Math.round(renderedWidth);
  const intrinsicHeight = Math.round(renderedWidth * (ASPECT_H / ASPECT_W));
  const src = imageUrl ?? `/cards/${cardId}-${CARD_IMAGE_WIDTH}.jpg`;

  return (
    <img
      src={src}
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
  );
}
