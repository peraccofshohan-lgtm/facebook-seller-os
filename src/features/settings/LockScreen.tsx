import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ErrorBanner, InfoBanner } from '@/components/ui/Feedback';
import { useAppContext } from '@/app/AppContext';
import { verifyPin } from '@/lib/crypto';
import { updateSettings } from '@/services/settingsService';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

/** Gate screen shown when a PIN lock is enabled. It hides the UI; it does not encrypt data. */
export function LockScreen() {
  const { settings, unlock } = useAppContext();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState(() => settings?.security?.pinRecord ?? null);

  if (!settings?.security?.pinEnabled || !settings.security.pinRecord) return null;

  const state = record ?? settings.security.pinRecord;
  const lockedUntil = state.lockedUntil ?? 0;
  const isLockedOut = lockedUntil > Date.now();

  const submit = async () => {
    setError(null);
    if (isLockedOut) return;
    const ok = await verifyPin(pin, state);
    if (ok) {
      await updateSettings({
        security: { pinEnabled: true, pinRecord: { ...state, failedAttempts: 0, lockedUntil: 0 } },
      });
      setPin('');
      unlock();
      return;
    }
    const attempts = (state.failedAttempts ?? 0) + 1;
    const nextRecord = {
      ...state,
      failedAttempts: attempts,
      lockedUntil: attempts >= MAX_ATTEMPTS ? Date.now() + LOCK_MINUTES * 60000 : 0,
    };
    setRecord(nextRecord);
    await updateSettings({ security: { pinEnabled: true, pinRecord: nextRecord } });
    setError(
      attempts >= MAX_ATTEMPTS
        ? `পিন ${MAX_ATTEMPTS} বার ভুল হয়েছে — ${LOCK_MINUTES} মিনিটের জন্য লক।`
        : `পিন সঠিক নয়। আর ${MAX_ATTEMPTS - attempts} বার চেষ্টা করতে পারবেন।`,
    );
    setPin('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-ink-200 bg-white p-6 shadow-card">
        <div className="mb-4 flex flex-col items-center">
          <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-brand-700 text-lg font-bold text-white">ফ</span>
          <h1 className="text-base font-semibold text-ink-900">{settings.business.name || 'Facebook Seller OS'}</h1>
          <p className="text-xs text-ink-500">পিন দিয়ে অ্যাপ খুলুন</p>
        </div>

        {error && <ErrorBanner message={error} />}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="পিন" required>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                inputMode="numeric"
                autoFocus
                dir="ltr"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                disabled={isLockedOut}
                placeholder="••••"
              />
            )}
          </Field>
          <Button block className="mt-3" type="submit" disabled={isLockedOut || pin.length < 4}>
            খুলুন
          </Button>
        </form>

        <div className="mt-4">
          <InfoBanner>
            পিন ভুলে গেলে অ্যাপের তথ্য মুছে ফেলতে হবে — পিন কোথাও সংরক্ষিত থাকে না। তাই নিয়মিত ব্যাকআপ রাখুন।
          </InfoBanner>
        </div>
      </div>
    </div>
  );
}
