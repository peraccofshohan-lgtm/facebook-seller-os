import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Global error boundary: shows a recoverable Bengali error screen with a "reload" action
 * and (deliberately) does not log business data anywhere.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Developer diagnostics only — no user records are included.
    console.error('[Facebook Seller OS] অপ্রত্যাশিত ত্রুটি:', error.message, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-6 text-center shadow-card">
          <h1 className="text-lg font-semibold text-ink-900">কিছু একটিতে সমস্যা হয়েছে</h1>
          <p className="mt-2 text-sm text-ink-600">
            অ্যাপটি অপ্রত্যাশিতভাবে বন্ধ হয়ে গেছে। আপনার সংরক্ষিত তথ্য নষ্ট হওয়ার কথা নয়। পেজ রিলোড করে আবার চেষ্টা করুন।
          </p>
          <p className="mt-3 rounded-lg bg-ink-50 p-2 text-left text-xs text-ink-500">{error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => window.location.reload()} icon="refresh">
              রিলোড করুন
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
