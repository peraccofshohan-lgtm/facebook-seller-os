/**
 * BrandingBlock.tsx — the seller's business identity on a printed or exported document.
 *
 * ONE component, deliberately. Invoices, courier booking slips, parcel labels, reports
 * and the dashboard all render the same business through the same code, so a seller who
 * changes their logo or phone number once sees it change everywhere at once.
 *
 * IDENTITY RULE (V2): everything rendered here comes from `settings.business`, which
 * belongs to the SELLER. The software developer's name is credited in Settings → About
 * only and is never reachable from this component.
 */

import type { ReactNode } from 'react';
import { FONT_SCALE_CLASS } from '@/domain/constants';
import type { BusinessProfile, BrandingSettings, Settings } from '@/domain/types';

export type BrandingSurface = 'invoice' | 'courierSlip' | 'parcelLabel' | 'report' | 'dashboard';

export interface BrandingBlockProps {
  settings: Settings | null;
  surface: BrandingSurface;
  /** Right-hand meta block (document number, date, status…). */
  meta?: ReactNode;
  /** Parcel labels have no room for the full block. */
  compact?: boolean;
  className?: string;
}

function wantsLogo(branding: BrandingSettings | undefined, surface: BrandingSurface): boolean {
  if (!branding) return surface === 'invoice';
  const map: Record<BrandingSurface, boolean> = {
    invoice: branding.showLogoOn.invoice,
    courierSlip: branding.showLogoOn.courierSlip,
    parcelLabel: branding.showLogoOn.parcelLabel,
    report: branding.showLogoOn.reports,
    dashboard: true,
  };
  return map[surface];
}

/** All the ways the business can be contacted, collapsed into one line. */
export function businessContactLine(business: BusinessProfile | undefined): string {
  if (!business) return '';
  return [business.phone, business.altPhone].filter(Boolean).join(' • ');
}

/** Full address including the area/district parts V2 added. */
export function businessAddressLines(business: BusinessProfile | undefined): string {
  if (!business) return '';
  const parts = [business.address, business.area, business.district].filter((p) => p && p.trim());
  return parts.join(', ');
}

export function BrandingBlock({ settings, surface, meta, compact = false, className = '' }: BrandingBlockProps) {
  const business = settings?.business;
  const branding = settings?.branding;
  const scale = FONT_SCALE_CLASS[branding?.fontScale ?? 'normal'];
  const showLogo = wantsLogo(branding, surface) && Boolean(business?.logoDataUrl);

  const contact = businessContactLine(business);
  const address = businessAddressLines(business);

  return (
    <header className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        {showLogo ? (
          <img
            src={business?.logoDataUrl ?? ''}
            alt={business?.name ? `${business.name} লোগো` : 'ব্যবসার লোগো'}
            className={compact ? 'h-8 w-8 rounded object-contain' : 'h-14 w-14 rounded object-contain'}
          />
        ) : null}
        <div className="min-w-0">
          <p className={`font-bold text-ink-900 ${compact ? 'text-sm' : 'text-lg'}`}>
            {business?.name || 'আমার ব্যবসা'}
          </p>
          {branding?.tagline && !compact ? (
            <p className="text-xs text-ink-500">{branding.tagline}</p>
          ) : null}
          {!compact && branding?.showBusinessDescription && business?.description ? (
            <p className={`mt-0.5 whitespace-pre-line text-ink-600 ${scale}`}>{business.description}</p>
          ) : null}
          {address ? (
            <p className={`whitespace-pre-line text-ink-600 ${compact ? 'text-[11px]' : 'text-xs'}`}>
              {address}
            </p>
          ) : null}
          {contact ? (
            <p className={`text-ink-600 ${compact ? 'text-[11px]' : 'text-xs'}`}>{contact}</p>
          ) : null}
          {!compact && business?.email ? (
            <p className="text-xs text-ink-600">{business.email}</p>
          ) : null}
          {!compact && business?.website ? (
            <p className="text-xs text-ink-600">{business.website}</p>
          ) : null}
          {!compact && business?.registrationNote ? (
            <p className="text-[11px] text-ink-500">{business.registrationNote}</p>
          ) : null}
        </div>
      </div>
      {meta ? <div className="shrink-0 text-right">{meta}</div> : null}
    </header>
  );
}

/**
 * The document footer: the seller's thank-you message, their terms, and the footer line
 * they configured. Also where the signature goes when they asked for one.
 */
export function BrandingFooter({
  settings,
  thankYou,
  children,
}: {
  settings: Settings | null;
  /** Override the configured thank-you message (e.g. a courier slip says something else). */
  thankYou?: string;
  children?: ReactNode;
}) {
  const branding = settings?.branding;
  const message = thankYou ?? settings?.business?.thankYouMessage ?? '';

  return (
    <footer className="mt-6 border-t border-ink-300 pt-3 text-[11px] text-ink-600">
      {children}
      {settings?.invoice.terms ? <p className="whitespace-pre-line">{settings.invoice.terms}</p> : null}
      {message ? <p className="mt-1 font-medium text-ink-700">{message}</p> : null}
      {branding?.documentFooter ? <p className="mt-1">{branding.documentFooter}</p> : null}

      {branding?.showSignature ? (
        <div className="mt-6 flex justify-end">
          <div className="w-48 border-t border-ink-400 pt-1 text-center">
            <p className="text-[11px] text-ink-600">{branding.signatureLabel}</p>
            {branding.signatureName || settings?.business?.ownerName ? (
              <p className="text-xs font-medium text-ink-800">
                {branding.signatureName || settings?.business?.ownerName}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </footer>
  );
}
