import type React from 'react';
import { Tooltip } from 'recharts';
import { useCoarsePointer } from '../lib/useChartHeight';

/**
 * Tooltip نمودارها با پشتیبانی لمس.
 *
 * روی دستگاه لمسی با یک تپ باز می‌شود و تا تپ بعدی می‌ماند تا کاربر مقدار را
 * بخواند؛ روی موس همان رفتار hover قبلی حفظ می‌شود. ناحیهٔ لمس خودِ بوم
 * نمودار است و CSS `touch-action: pan-y` باعث می‌شود کشیدن افقی روی نمودار
 * صفحه را اسکرول نکند.
 */
export default function ChartTooltip(props: React.ComponentProps<typeof Tooltip>) {
  const coarse = useCoarsePointer();
  return <Tooltip {...props} trigger={coarse ? 'click' : 'hover'} />;
}
