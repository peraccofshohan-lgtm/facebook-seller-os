/**
 * qr.ts — QR codes for courier documents (V2).
 *
 * Uses `qrcode-generator` (MIT, ~10 kB, no runtime network access) rather than hand-
 * rolling an encoder: QR error correction is easy to get subtly wrong, and a QR code
 * that one scanner reads and another rejects is worse than no QR code at all.
 *
 * WHAT IT ENCODES: tracking / consignment ids and order references — ASCII. It is not
 * used for Bangla text, because the UTF-8 payload would be large and fragile on the
 * cheap scanners actually used at Bangladeshi courier hubs.
 */

import qrcode from 'qrcode-generator';
import { escapeXml } from './barcode';

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/**
 * Build a QR SVG for `text`.
 *
 * Returns null instead of throwing when the data will not fit, so a long reference
 * degrades to "no QR" rather than breaking the printed label.
 */
export function qrSvg(
  text: string,
  options: { size?: number; margin?: number; level?: QrErrorCorrection } = {},
): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const level = options.level ?? 'M';
  const margin = options.margin ?? 2;

  try {
    const qr = qrcode(0, level);
    qr.addData(trimmed);
    qr.make();
    const count = qr.getModuleCount();
    const size = options.size ?? 96;
    const total = count + margin * 2;
    const scale = size / total;

    let cells = '';
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (!qr.isDark(row, column)) continue;
        cells += `<rect x="${(column + margin) * scale}" y="${(row + margin) * scale}" width="${scale}" height="${scale}"/>`;
      }
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
      `shape-rendering="crispEdges" role="img" aria-label="QR ${escapeXml(trimmed)}">` +
      `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${cells}</g></svg>`
    );
  } catch {
    // Too much data for the version / correction level.
    return null;
  }
}

/**
 * The payload printed under a parcel label's QR code.
 *
 * Deliberately a short ASCII reference rather than a vCard or a URL: it is what a courier
 * hub can key in or scan, and it leaks nothing about the customer beyond the consignment.
 */
export function courierQrPayload(consignmentId: string, orderNumber: string): string {
  const parts = [consignmentId.trim(), orderNumber.trim()].filter(Boolean);
  return parts.join('|');
}
