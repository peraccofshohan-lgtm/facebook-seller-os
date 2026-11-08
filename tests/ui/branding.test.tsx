/**
 * branding.test.tsx — the business identity, and the rule that protects it.
 *
 * The most important assertion in this file is the negative one: the software
 * developer's name must never appear on a customer-facing document. Everything a seller
 * prints belongs to the seller, and a bug that leaks the developer's name onto an
 * invoice would be an embarrassment for every shop using the app.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrandingBlock, BrandingFooter, businessAddressLines, businessContactLine } from '@/features/branding/BrandingBlock';
import { LogoUploadField } from '@/features/branding/LogoUploadField';
import { getSettings, updateSettings } from '@/services/settingsService';
import { defaultSettings } from '@/db/defaults';
import { SOFTWARE_DEVELOPER } from '@/domain/constants';
import type { Settings } from '@/domain/types';

const LOGO =
  'data:image/svg+xml;base64,' +
  btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

async function saveBusiness(partial: Partial<Settings['business']>, branding?: Partial<Settings['branding']>) {
  const current = await getSettings();
  const next = await updateSettings({
    business: { ...current.business, ...partial },
    ...(branding ? { branding: { ...current.branding, ...branding } } : {}),
  });
  return next;
}

describe('business branding on documents', () => {
  it('shows the seller identity the seller configured, on every surface', async () => {
    const settings = await saveBusiness({
      name: 'রিমা কালেকশন',
      ownerName: 'রিমা আক্তার',
      phone: '01712345678',
      altPhone: '01812345678',
      email: 'rima@example.com',
      website: 'facebook.com/rima',
      address: '১২, মেইন রোড',
      area: 'ধনবাড়ী',
      district: 'টাঙ্গাইল',
      description: 'নারীদের পোশাকের দোকান',
      registrationNote: 'ট্রেড লাইসেন্স: ৯৮৭',
      logoDataUrl: LOGO,
    });

    for (const surface of ['invoice', 'courierSlip', 'report'] as const) {
      const { unmount } = render(<BrandingBlock settings={settings} surface={surface} />);
      expect(screen.getByText('রিমা কালেকশন')).toBeTruthy();
      expect(screen.getByText(/১২, মেইন রোড/)).toBeTruthy();
      // Area and district are part of the address, not separate clutter.
      expect(screen.getByText(/ধনবাড়ী/)).toBeTruthy();
      expect(screen.getByText(/টাঙ্গাইল/)).toBeTruthy();
      expect(screen.getByText(/01712345678/)).toBeTruthy();
      expect(screen.getByText(/01812345678/)).toBeTruthy();
      expect(screen.getByText('rima@example.com')).toBeTruthy();
      expect(screen.getByText('facebook.com/rima')).toBeTruthy();
      expect(screen.getByText(/ট্রেড লাইসেন্স: ৯৮৭/)).toBeTruthy();
      unmount();
    }
  });

  it('NEVER puts the software developer identity on a business document', async () => {
    const settings = await saveBusiness({
      name: 'রিমা কালেকশন',
      ownerName: 'রিমা আক্তার',
      phone: '01712345678',
      logoDataUrl: LOGO,
    });

    for (const surface of ['invoice', 'courierSlip', 'parcelLabel', 'report', 'dashboard'] as const) {
      const { container, unmount } = render(<BrandingBlock settings={settings} surface={surface} />);
      const text = container.textContent ?? '';
      expect(text).not.toContain(SOFTWARE_DEVELOPER.name);
      expect(text).not.toContain(SOFTWARE_DEVELOPER.email);
      unmount();
    }

    // Nor in the footer, which carries the thank-you message and the signature.
    const { container } = render(<BrandingFooter settings={settings} />);
    const footerText = container.textContent ?? '';
    expect(footerText).not.toContain(SOFTWARE_DEVELOPER.name);
    expect(footerText).not.toContain(SOFTWARE_DEVELOPER.email);
  });

  it('keeps two businesses separate — one app, one identity per install', async () => {
    const first = await saveBusiness({ name: 'প্রথম দোকান', phone: '01700000001', logoDataUrl: LOGO });
    const second: Settings = {
      ...defaultSettings('2.0.0'),
      business: {
        ...first.business,
        name: 'দ্বিতীয় দোকান',
        phone: '01700000002',
        ownerName: 'দ্বিতীয় মালিক',
      },
    };

    const a = render(<BrandingBlock settings={first} surface="invoice" />);
    expect(screen.getByText('প্রথম দোকান')).toBeTruthy();
    expect(screen.getByText(/01700000001/)).toBeTruthy();
    expect(screen.queryByText('দ্বিতীয় দোকান')).toBeNull();
    a.unmount();

    render(<BrandingBlock settings={second} surface="invoice" />);
    expect(screen.getByText('দ্বিতীয় দোকান')).toBeTruthy();
    expect(screen.getByText(/01700000002/)).toBeTruthy();
    expect(screen.queryByText('প্রথম দোকান')).toBeNull();
  });

  it('follows the per-document logo switches', async () => {
    const settings = await saveBusiness(
      { name: 'লোগো টেস্ট', logoDataUrl: LOGO },
      { showLogoOn: { invoice: true, courierSlip: true, parcelLabel: false, reports: false } },
    );

    const withLogo = render(<BrandingBlock settings={settings} surface="invoice" />);
    expect(screen.getByAltText('লোগো টেস্ট লোগো')).toBeTruthy();
    withLogo.unmount();

    const withoutLogo = render(<BrandingBlock settings={settings} surface="parcelLabel" compact />);
    expect(screen.queryByAltText(/লোগো/)).toBeNull();
    // …but the name is still there, because a label with no sender is useless.
    expect(screen.getByText('লোগো টেস্ট')).toBeTruthy();
    withoutLogo.unmount();
  });

  it('shows the configured thank-you message and signature', async () => {
    const settings = await saveBusiness(
      { name: 'ধন্যবাদ দোকান', ownerName: 'মালিকের নাম', thankYouMessage: 'আবার আসবেন!' },
      { showSignature: true, signatureLabel: 'ক্ষমতাপ্রাপ্ত ব্যক্তির স্বাক্ষর', signatureName: '' },
    );

    render(<BrandingFooter settings={settings} />);
    expect(screen.getByText('আবার আসবেন!')).toBeTruthy();
    expect(screen.getByText('ক্ষমতাপ্রাপ্ত ব্যক্তির স্বাক্ষর')).toBeTruthy();
    // Falls back to the owner name when no explicit signatory is set.
    expect(screen.getByText('মালিকের নাম')).toBeTruthy();
  });

  it('falls back to a neutral heading when the business has no name yet', async () => {
    const settings = await saveBusiness({ name: '' });
    render(<BrandingBlock settings={settings} surface="invoice" />);
    expect(screen.getByText('আমার ব্যবসা')).toBeTruthy();
  });

  it('joins address and contact parts into single lines', () => {
    expect(
      businessAddressLines({ address: 'বাড়ী ১২', area: 'ধনবাড়ী', district: 'টাঙ্গাইল' } as never),
    ).toBe('বাড়ী ১২, ধনবাড়ী, টাঙ্গাইল');
    expect(businessContactLine({ phone: '01711111111', altPhone: '01822222222' } as never)).toBe(
      '01711111111 • 01822222222',
    );
    // No stray separators when a part is missing.
    expect(businessContactLine({ phone: '01711111111', altPhone: '' } as never)).toBe('01711111111');
  });
});

describe('logo upload', () => {
  it('accepts an SVG logo and reports it back', async () => {
    const seen: Array<string | null> = [];
    render(<LogoUploadField value={null} businessName="টেস্ট" onChange={(v) => seen.push(v)} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'], 'logo.svg', {
      type: 'image/svg+xml',
    });
    // applyAccept:false simulates someone picking a file the picker tried to hide.
    await userEvent.upload(input, file, { applyAccept: false });

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('rejects a file that is not an image', async () => {
    const seen: Array<string | null> = [];
    render(<LogoUploadField value={null} businessName="টেস্ট" onChange={(v) => seen.push(v)} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }), {
      applyAccept: false,
    });

    expect(seen).toHaveLength(0);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('PNG, JPG, WebP');
  });

  it('rejects an SVG that could execute script', async () => {
    const seen: Array<string | null> = [];
    render(<LogoUploadField value={null} businessName="টেস্ট" onChange={(v) => seen.push(v)} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'bad.svg', {
        type: 'image/svg+xml',
      }),
      { applyAccept: false },
    );

    expect(seen).toHaveLength(0);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('নিরাপদ নয়');
  });

  it('shows the current logo and lets it be replaced or removed', async () => {
    const seen: Array<string | null> = [];
    render(<LogoUploadField value={LOGO} businessName="রিমা কালেকশন" onChange={(v) => seen.push(v)} />);

    expect(screen.getByAltText('রিমা কালেকশন লোগো')).toBeTruthy();
    // The button says "replace" when a logo already exists.
    expect(screen.getByRole('button', { name: /লোগো বদলান/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /সরিয়ে দিন/ }));
    expect(seen).toEqual([null]);
  });

  it('shows an upload button and no remove button when there is no logo', () => {
    render(<LogoUploadField value={null} businessName="টেস্ট" onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: /লোগো আপলোড করুন/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /সরিয়ে দিন/ })).toBeNull();
  });
});
