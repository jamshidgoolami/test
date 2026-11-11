import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, isAbortError } from '../../../lib/api';
import type { DiagramSummary } from '../../../lib/types';

export type DiagramToast = (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void;

/**
 * فهرست دیاگرام‌ها و بارگذاری مجدد آن.
 * هر بارگذاری یک bلیت می‌گیرد تا پاسخ کندِ درخواست قدیمی فهرست تازه را
 * بازنویسی نکند؛ خطای فهرست فقط Toast می‌شود و بوم را از کار نمی‌اندازد.
 */
export function useDiagramList(push: DiagramToast) {
  const [list, setList] = useState<DiagramSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const gateRef = useRef(0);

  const loadList = useCallback(async () => {
    const gate = ++gateRef.current;
    setListLoading(true);
    try {
      const res = await api.diagrams();
      if (gate === gateRef.current) setList(res.items);
    } catch (error) {
      if (!isAbortError(error)) {
        push(error instanceof ApiError ? error.message : 'دریافت فهرست دیاگرام‌ها ناموفق بود.', 'error');
      }
    } finally {
      if (gate === gateRef.current) setListLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  return { list, setList, listLoading, loadList };
}
