import { Field, Modal } from '../../../components/ui';
import type { EditorDialog } from './types';

interface DiagramEditorDialogProps {
  dialog: EditorDialog | null;
  name: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
}

/** فرم ساخت/ویرایش متادیتای دیاگرام؛ state فرم در صفحه می‌ماند. */
export function DiagramEditorDialog({
  dialog,
  name,
  description,
  busy,
  onClose,
  onNameChange,
  onDescriptionChange,
  onSubmit,
}: DiagramEditorDialogProps) {
  return (
    <Modal
      open={!!dialog}
      onClose={onClose}
      title={dialog?.mode === 'create' ? 'دیاگرام جدید' : 'ویرایش اطلاعات دیاگرام'}
      subtitle={
        dialog?.mode === 'create'
          ? dialog.parentId
            ? 'این دیاگرام به‌عنوان زیرمجموعهٔ دیاگرام فعلی ساخته می‌شود و بوم مستقل دارد.'
            : 'یک دیاگرام ریشه با بوم خالی ساخته می‌شود.'
          : 'نام و توضیح دیاگرام را تغییر دهید.'
      }
      size="sm"
      footer={
        <>
          <button type="button" className="btn-ghost btn-xs" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button type="button" className="btn-primary btn-xs" onClick={onSubmit} disabled={busy}>
            {busy ? 'در حال ذخیره…' : dialog?.mode === 'create' ? 'ساخت دیاگرام' : 'ذخیره'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="نام دیاگرام" required>
          <input
            className="field"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="مثلاً شبکهٔ شهر تهران"
            autoFocus
            maxLength={120}
          />
        </Field>
        <Field label="توضیحات" hint="اختیاری — برای یادآوری محدوده و هدف این دیاگرام">
          <textarea
            className="field min-h-20 resize-y"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            maxLength={2000}
          />
        </Field>
      </div>
    </Modal>
  );
}
