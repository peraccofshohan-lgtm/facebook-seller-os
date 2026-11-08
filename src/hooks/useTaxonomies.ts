import { useMemo } from 'react';
import { db } from '@/db/db';
import { useAsync } from './useAsync';
import { useAppContext } from '@/app/AppContext';
import { DEFAULT_CHANNELS, DEFAULT_ORDER_STATUSES } from '@/domain/constants';
import type { CourierProvider, ExpenseCategory, PaymentMethod, ProductCategory, Timestamp } from '@/domain/types';

export interface Option {
  value: string;
  label: string;
}

function toOptions<T extends { id: string; name: string; archivedAt?: Timestamp | null }>(rows: T[]): Option[] {
  return rows.filter((row) => !row.archivedAt).map((row) => ({ value: row.id, label: row.name }));
}

export function usePaymentMethods(): { options: Option[]; rows: PaymentMethod[]; loading: boolean } {
  const { version } = useAppContext();
  const state = useAsync(async () => {
    const rows = await db.paymentMethods.toArray();
    return rows.filter((row) => row.isActive).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  }, [version]);
  return { options: toOptions(state.data ?? []), rows: state.data ?? [], loading: state.loading };
}

export function useCourierProviders(): { options: Option[]; rows: CourierProvider[]; loading: boolean } {
  const { version } = useAppContext();
  const state = useAsync(async () => {
    const rows = await db.courierProviders.toArray();
    return rows.filter((row) => row.isActive).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  }, [version]);
  return { options: toOptions(state.data ?? []), rows: state.data ?? [], loading: state.loading };
}

export function useProductCategories(): { options: Option[]; rows: ProductCategory[]; loading: boolean } {
  const { version } = useAppContext();
  const state = useAsync(async () => {
    const rows = await db.productCategories.toArray();
    return rows.filter((row) => !row.archivedAt).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  }, [version]);
  return { options: toOptions(state.data ?? []), rows: state.data ?? [], loading: state.loading };
}

export function useExpenseCategories(): { options: Option[]; rows: ExpenseCategory[]; loading: boolean } {
  const { version } = useAppContext();
  const state = useAsync(async () => {
    const rows = await db.expenseCategories.toArray();
    return rows.filter((row) => !row.archivedAt).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  }, [version]);
  return { options: toOptions(state.data ?? []), rows: state.data ?? [], loading: state.loading };
}

export function useOrderStatuses() {
  return useMemo(() => DEFAULT_ORDER_STATUSES.map((status) => ({ value: status.key, label: status.label, tone: status.tone })), []);
}

export function useChannels() {
  return useMemo(() => DEFAULT_CHANNELS.map((channel) => ({ value: channel.key, label: channel.label })), []);
}

/** Status label + tone lookup helpers used across screens. */
export function useStatusMeta() {
  return useMemo(() => {
    const label = new Map(DEFAULT_ORDER_STATUSES.map((s) => [s.key, s.label]));
    const tone = new Map(DEFAULT_ORDER_STATUSES.map((s) => [s.key, s.tone]));
    return {
      label: (key: string) => label.get(key as never) ?? key,
      tone: (key: string) => tone.get(key as never) ?? 'neutral',
    };
  }, []);
}
