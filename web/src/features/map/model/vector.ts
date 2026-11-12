export type GlFeature = {
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown };
};

/** حداقلی از API مپ‌لیبر که برای پایش استایل و خواندن نام مکان‌ها لازم است. */
export type GlMap = {
  on: (event: string, fn: () => void) => void;
  off: (event: string, fn: () => void) => void;
  getStyle?: () => { layers?: { id: string }[] } | undefined;
  queryRenderedFeatures: (options: { layers: string[] }) => GlFeature[];
};
