/**
 * LogoUploadField.tsx — upload, preview, replace and remove the business logo.
 *
 * The file never leaves the device: it is decoded in a canvas, downscaled and stored as
 * a data URL inside IndexedDB. There is no upload endpoint, no image host and nothing to
 * pay for.
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { ALLOWED_IMAGE_TYPES, MAX_LOGO_BYTES, processLogoFile } from '@/lib/image';

export interface LogoUploadFieldProps {
  value: string | null;
  businessName: string;
  onChange: (dataUrl: string | null) => void;
  /** Compact layout for the first-run setup screen. */
  compact?: boolean;
}

export function LogoUploadField({ value, businessName, onChange, compact = false }: LogoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      onChange(await processLogoFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      // Reset so picking the same file twice still fires a change event.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <div
          className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-ink-50 ${
            compact ? 'h-16 w-16' : 'h-24 w-24'
          }`}
        >
          {value ? (
            <img
              src={value}
              alt={businessName ? `${businessName} লোগো` : 'ব্যবসার লোগো'}
              className="h-full w-full object-contain"
            />
          ) : (
            <Icon name="user" className="h-7 w-7 text-ink-300" />
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              icon="upload"
              loading={busy}
              onClick={() => inputRef.current?.click()}
            >
              {value ? 'লোগো বদলান' : 'লোগো আপলোড করুন'}
            </Button>
            {value ? (
              <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => onChange(null)}>
                সরিয়ে দিন
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-ink-500">
            PNG, JPG, WebP বা SVG — সর্বোচ্চ {Math.round(MAX_LOGO_BYTES / (1024 * 1024))} মেগাবাইট।
            ছবিটি ডিভাইসেই থাকে, কোথাও আপলোড হয় না।
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
        onDrop={(event) => {
          event.preventDefault();
          void handleFile(event.dataTransfer.files?.[0]);
        }}
      />

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
    </div>
  );
}
