const CONTOUR_POWER = 8;

/** Opposite glows follow the screen outline while rotating steadily between edges. */
export function glowGeometry(angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const radius =
    0.5 / (Math.abs(cos) ** CONTOUR_POWER + Math.abs(sin) ** CONTOUR_POWER) ** (1 / CONTOUR_POWER);
  // Following the contour's exact tangent concentrates rotation at the corners
  // and almost freezes it at each edge's midpoint. Rotate with sweep progress
  // instead, while the centres still hug the same rounded screen contour.
  const axis = [sin, -cos] as [number, number];
  return {
    uBlue: [0.5 + radius * cos, 0.5 + radius * sin] as [number, number],
    uRed: [0.5 - radius * cos, 0.5 - radius * sin] as [number, number],
    axis,
    // Match the existing full-width top/bottom glow and full-height side glow.
    radii: [1.2, 0.52 + 0.03 * sin ** 2] as [number, number],
  };
}
