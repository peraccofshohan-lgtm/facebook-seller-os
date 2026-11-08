import { describe, expect, it } from 'vitest';
import {
  backupFilename,
  buildBackupFile,
  buildEncryptedBackup,
  inspectBackup,
  inspectEncryptedBackup,
  isBackupDue,
  markBackupTaken,
  previewRestore,
  restoreBackup,
} from '@/services/backupService';
import { createOrder } from '@/services/orderService';
import { createExpense } from '@/services/expenseService';
import { getSettings, updateSettings } from '@/services/settingsService';
import { parseMoney } from '@/lib/money';
import { fromDateInputValue } from '@/lib/date';
import { line, orderInput, seedProductWithStock } from '../helpers/factories';
import { BACKUP_TABLES, db } from '@/db/db';

const tk = parseMoney;

async function seedBusiness() {
  const product = await seedProductWithStock(20, '400', '700');
  await createOrder(orderInput({ items: [line(product.id, 2, '700')], status: 'delivered' }));
  await createExpense({
    date: fromDateInputValue('2026-11-08') ?? Date.now(),
    categoryId: null,
    amount: tk('250'),
    method: 'cash',
    payee: '',
    reference: '',
    description: 'প্যাকেজিং',
    note: '',
  } as Parameters<typeof createExpense>[0]);
}

describe('backup files', () => {
  it('contains every table and a verifiable meta block', async () => {
    await seedBusiness();
    const file = await buildBackupFile('test-device');
    expect(file.meta.format).toBe('facebook-seller-os-backup');
    expect(file.meta.encrypted).toBe(false);
    expect(file.meta.deviceLabel).toBe('test-device');
    expect(file.meta.counts.orders).toBe(1);
    expect(file.meta.counts.expenses).toBe(1);
    expect(file.meta.counts.products).toBe(1);

    for (const table of BACKUP_TABLES) {
      expect(Object.keys(file.data)).toContain(table);
    }
    expect(backupFilename(false)).toMatch(/^facebook-seller-os-backup-\d{8}-\d{4}\.json$/);
  });

  it('round-trips through inspect → restore without losing data', async () => {
    await seedBusiness();
    const file = await buildBackupFile();
    const text = JSON.stringify(file);

    // Wipe everything, then restore from the file.
    await db.transaction('rw', BACKUP_TABLES.map((name) => db.table(name)), async () => {
      await Promise.all(BACKUP_TABLES.map((name) => db.table(name).clear()));
    });
    expect(await db.orders.count()).toBe(0);

    const inspection = inspectBackup(text);
    expect(inspection.valid).toBe(true);
    expect(inspection.issues.filter((i) => i.level === 'error')).toHaveLength(0);

    const preview = await previewRestore(inspection.payload!, 'merge');
    // A merge into an empty database adds everything and skips nothing.
    for (const row of preview) {
      expect(row.add).toBe(row.incoming);
      expect(row.skip).toBe(0);
    }

    const result = await restoreBackup(inspection.payload!, 'merge');
    expect(Object.keys(result.counts)).toHaveLength(BACKUP_TABLES.length);
    expect(result.counts.orders.added).toBe(1);
    expect(result.counts.products.added).toBe(1);
    expect(await db.orders.count()).toBe(1);
    expect(await db.products.count()).toBe(1);
    expect(await db.expenses.count()).toBe(1);
    expect(await db.stockMovements.count()).toBeGreaterThan(0);
  });

  it('merging a backup never deletes local records', async () => {
    const product = await seedProductWithStock(20, '400', '700');
    const first = await createOrder(orderInput({ items: [line(product.id, 1, '700')] }));
    const backup = await buildBackupFile();

    // Create a second, local-only order after the backup was taken.
    const local = await createOrder(orderInput({ items: [line(product.id, 3, '700')] }));

    const inspection = inspectBackup(JSON.stringify(backup));
    await restoreBackup(inspection.payload!, 'merge');
    expect(await db.orders.get(first.id)).toBeDefined();
    expect(await db.orders.get(local.id)).toBeDefined();
    expect(await db.orders.count()).toBe(2);
  });

  it('replacing with a backup removes records that are not in the file', async () => {
    const product = await seedProductWithStock(20, '400', '700');
    await createOrder(orderInput({ items: [line(product.id, 1, '700')] }));
    const backup = await buildBackupFile();
    const localOnly = await createOrder(orderInput({ items: [line(product.id, 9, '700')] }));

    const inspection = inspectBackup(JSON.stringify(backup));
    await restoreBackup(inspection.payload!, 'replace');
    expect(await db.orders.get(localOnly.id)).toBeUndefined();
    expect(await db.orders.count()).toBe(1);
  });

  it('rejects files that are not backups', () => {
    expect(inspectBackup('not json at all').valid).toBe(false);
    expect(inspectBackup('{"hello":1}').valid).toBe(false);
    expect(inspectBackup('{"meta":{"format":"something-else"}}').valid).toBe(false);
  });

  it('warns (not blocks) when the payload no longer matches its checksum', async () => {
    await seedBusiness();
    const file = await buildBackupFile();
    const parsed = JSON.parse(JSON.stringify(file));
    parsed.data.orders[0].total = 99999999;

    const inspection = inspectBackup(JSON.stringify(parsed));
    // The checksum is a tamper *indicator*, not a signature: the checksum mismatch is
    // surfaced to the user as a warning, because an edited backup may still be the only
    // copy of the data a seller has. It never silently overwrites.
    expect(inspection.issues.some((i) => i.level === 'warning' && /চেকসাম/.test(i.message))).toBe(true);
    expect(inspection.issues.some((i) => i.level === 'error')).toBe(false);
    expect(inspection.valid).toBe(true);
  });

  it('rejects a backup that is missing a table', async () => {
    await seedBusiness();
    const file = await buildBackupFile();
    const parsed = JSON.parse(JSON.stringify(file));
    delete parsed.data.orders;
    const inspection = inspectBackup(JSON.stringify(parsed));
    expect(inspection.valid).toBe(false);
    expect(inspection.issues.some((i) => i.level === 'error')).toBe(true);
  });
});

describe('encrypted backups', () => {
  const PASSWORD = 'shanto-12345';

  it('opens with the right password and refuses the wrong one', async () => {
    await seedBusiness();
    const { meta, envelope } = await buildEncryptedBackup(PASSWORD, 'phone');
    expect(meta.encrypted).toBe(true);
    expect(backupFilename(true).endsWith('.fsos')).toBe(true);

    // This is exactly what the app writes to disk.
    const text = JSON.stringify({ meta, envelope });
    const inspection = inspectBackup(text);
    expect(inspection.encrypted).toBe(true);
    expect(inspection.payload).toBeNull();
    expect(inspection.envelope).not.toBeNull();

    await expect(inspectEncryptedBackup(envelope, meta, 'wrong-password')).rejects.toThrow();

    const unlocked = await inspectEncryptedBackup(envelope, meta, PASSWORD);
    expect(unlocked.valid).toBe(true);
    expect(unlocked.payload?.orders).toHaveLength(1);
    expect(unlocked.payload?.products).toHaveLength(1);

    // And the decrypted payload restores.
    await db.transaction('rw', BACKUP_TABLES.map((name) => db.table(name)), async () => {
      await Promise.all(BACKUP_TABLES.map((name) => db.table(name).clear()));
    });
    await restoreBackup(unlocked.payload!, 'merge');
    expect(await db.orders.count()).toBe(1);
  });
});

describe('backup reminders', () => {
  it('is due when there is no backup yet, and stops being due right after one', async () => {
    expect(isBackupDue(null, 7)).toBe(true);
    const now = Date.now();
    expect(isBackupDue(now, 7, now)).toBe(false);
    expect(isBackupDue(now - 8 * 86400000, 7, now)).toBe(true);
    expect(isBackupDue(now - 3 * 86400000, 7, now)).toBe(false);
  });

  it('records the backup timestamp in settings', async () => {
    await markBackupTaken();
    const settings = await getSettings();
    expect(settings.backup.lastBackupAt).toBeGreaterThan(0);
    expect(isBackupDue(settings.backup.lastBackupAt, 7)).toBe(false);
    await updateSettings({ backup: { ...settings.backup, lastBackupAt: null } });
  });
});
