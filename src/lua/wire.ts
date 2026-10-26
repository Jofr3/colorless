/** The Lua mailbox wire: fields are percent-encoded and TAB-joined, rows are
 * newline-joined. */
export const encodeFields = (fields: (string | number | boolean)[]) =>
  fields.map((v) => encodeURIComponent(String(v))).join("\t");

export const encodeRows = (rows: (string | number | boolean)[][]) =>
  rows.map(encodeFields).join("\n");

/** null when a field holds a malformed %-sequence. */
export function decodeFields(raw: string): string[] | null {
  try {
    return raw.split("\t").map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** m6x11plus has no arrow, middle dot, em dash, minus or ellipsis glyphs; the
    engine's log and card text use them, so spell them in ASCII for Lua. */
export function pixelText(text: string): string {
  return text
    .replace(/\s*→\s*/g, " -> ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s*—\s*/g, " - ")
    .replace(/−/g, "-")
    .replace(/…/g, "...");
}
