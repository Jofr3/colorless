/** Recover transient image failures without leaving a newly played card blank. */
export async function loadCardBitmap(textureUrl: string): Promise<ImageBitmap> {
  const retryDelays = [250, 500, 1000];
  for (let attempt = 0; ; attempt += 1) {
    let retryable = true;
    try {
      const response = await fetch(textureUrl, {
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) {
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new Error(`Unable to load card texture: ${textureUrl} (${response.status})`);
      }
      const blob = await response.blob();
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch (error) {
      const delay = retryDelays[attempt];
      if (!retryable || delay === undefined) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}
