import React from 'react';
import { Link } from 'react-router-dom';
import {
  Cable,
  Database,
  Eye,
  Globe,
  KeyRound,
  Mail,
  Pencil,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  TriangleAlert,
  Wifi,
} from 'lucide-react';
import { Badge } from '../../components/ui';
import { credentialTarget, strengthMeta } from '../../lib/credential-rules';
import { faDigits, fmtRelative } from '../../lib/format';
import type { Credential, CredentialKind } from '../../lib/types';

const KIND_ICON: Record<CredentialKind, React.ReactNode> = {
  ssh: <Terminal size={14} />,
  https: <Globe size={14} />,
  telnet: <Terminal size={14} />,
  snmp: <Server size={14} />,
  console: <Cable size={14} />,
  wifi: <Wifi size={14} />,
  api: <KeyRound size={14} />,
  database: <Database size={14} />,
  mail: <Mail size={14} />,
  other: <KeyRound size={14} />,
};

function StrengthCell({ credential }: { credential: Credential }) {
  const meta = strengthMeta(credential.strength);
  return (
    <div className="min-w-[86px]">
      <span className={`inline-flex items-center gap-1 text-[11.5px] font-medium ${meta.text}`}>
        {credential.weak ? <TriangleAlert size={12} /> : null}
        {credential.strengthLabel}
      </span>
      <div className="mt-1 flex gap-0.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="h-1 w-3 rounded-pill"
            style={{ background: index <= credential.strength ? meta.bar : 'rgb(var(--nw-ink-200, 226 232 240))' }}
          />
        ))}
      </div>
      {credential.weak && credential.weakReasons.length ? (
        <p className="mt-0.5 max-w-[150px] truncate text-[10px] text-ink-400" title={credential.weakReasons.join(' ')}>
          {credential.weakReasons[0]}
        </p>
      ) : null}
    </div>
  );
}

/**
 * جدول مخزن اعتبارنامه. رمز هیچ‌گاه در این جدول رندر نمی‌شود؛ فقط دکمهٔ
 * «نمایش» که مسیر reveal را با مجوز و حسابرسی صدا می‌زند.
 */
export default function CredentialsTable({
  items,
  canWrite,
  canReveal,
  onReveal,
  onEdit,
  onRotate,
  onDelete,
}: {
  items: Credential[];
  canWrite: boolean;
  canReveal: boolean;
  onReveal: (credential: Credential) => void;
  onEdit: (credential: Credential) => void;
  onRotate: (credential: Credential) => void;
  onDelete: (credential: Credential) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="text-right">اعتبارنامه</th>
            <th className="hidden text-right md:table-cell">هدف اتصال</th>
            <th className="hidden text-right lg:table-cell">تجهیز</th>
            <th className="text-right">قدرت</th>
            <th className="hidden text-right sm:table-cell">آخرین چرخش</th>
            <th className="text-left">عملیات</th>
          </tr>
        </thead>
        <tbody>
          {items.map((credential) => {
            const target = credentialTarget(credential);
            return (
              <tr key={credential.id}>
                <td>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-soft border border-brand-100 bg-brand-50 text-accent">
                      {KIND_ICON[credential.kind] ?? KIND_ICON.other}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink-800" title={credential.label}>
                        {credential.label}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge tone="ink" className="!px-1.5 !py-0 !text-[10px]">
                          {credential.kindLabel}
                        </Badge>
                        {credential.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} tone="brand" className="!px-1.5 !py-0 !text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                        {credential.due ? (
                          <Badge tone="sun" className="!px-1.5 !py-0 !text-[10px]">
                            موعد چرخش
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </td>

                <td className="hidden md:table-cell">
                  <span className="block max-w-[190px] truncate font-mono text-[12px] text-ink-700" dir="ltr" title={target}>
                    {target}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-ink-400">
                    {credential.hasSecret ? 'رمز ذخیره شده' : 'بدون رمز'}
                  </span>
                </td>

                <td className="hidden lg:table-cell">
                  {credential.deviceId ? (
                    <Link
                      to={`/devices/${credential.deviceId}`}
                      className="block max-w-[160px] truncate text-[12px] text-accent hover:underline"
                      title={`${credential.deviceName ?? ''} ${credential.deviceIp ?? ''}`}
                    >
                      {credential.deviceName ?? `تجهیز #${credential.deviceId}`}
                      <span className="mt-0.5 block font-mono text-[10.5px] text-ink-400" dir="ltr">
                        {credential.deviceIp}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-[11.5px] text-ink-300">—</span>
                  )}
                </td>

                <td>
                  <StrengthCell credential={credential} />
                </td>

                <td className="hidden sm:table-cell">
                  <span className="block text-[11.5px] text-ink-600">
                    {credential.lastRotatedAt ? fmtRelative(credential.lastRotatedAt) : 'ثبت نشده'}
                  </span>
                  <span className="text-[10.5px] text-ink-400">
                    {credential.rotateEveryDays ? `هر ${faDigits(credential.rotateEveryDays)} روز` : 'بدون دوره'}
                  </span>
                </td>

                <td>
                  <div className="flex items-center justify-end gap-1">
                    {canReveal ? (
                      <button
                        type="button"
                        className="btn-ghost btn-xs px-2"
                        onClick={() => onReveal(credential)}
                        title="نمایش رمز"
                        aria-label={`نمایش رمز ${credential.label}`}
                        disabled={!credential.hasSecret}
                      >
                        <Eye size={14} />
                      </button>
                    ) : null}
                    {canWrite ? (
                      <>
                        <button
                          type="button"
                          className="btn-ghost btn-xs px-2"
                          onClick={() => onEdit(credential)}
                          title="ویرایش"
                          aria-label={`ویرایش ${credential.label}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-xs px-2"
                          onClick={() => onRotate(credential)}
                          title="ثبت چرخش رمز"
                          aria-label={`ثبت چرخش ${credential.label}`}
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-xs px-2 text-danger hover:bg-red-50"
                          onClick={() => onDelete(credential)}
                          title="حذف"
                          aria-label={`حذف ${credential.label}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
