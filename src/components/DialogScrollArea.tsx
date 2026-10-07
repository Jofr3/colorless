import type { ReactNode } from "react";
import { ScrollArea } from "./ScrollArea";

/** Share the deck builder's draggable scrollbar with popup choices. */
export function DialogScrollArea({
  children,
  as: Content = "ul",
  className,
  contentClassName,
  trackInset = 0,
}: {
  children: ReactNode;
  as?: "ul" | "div";
  className?: string;
  contentClassName?: string;
  trackInset?: number;
}) {
  return (
    <ScrollArea
      outerClassName={`dialog-scroll-area flex flex-col${className ? ` ${className}` : ""}`}
      className="min-h-0 overscroll-contain"
      trackTop={trackInset}
      trackBottom={trackInset}
    >
      <Content className={contentClassName}>{children}</Content>
    </ScrollArea>
  );
}
