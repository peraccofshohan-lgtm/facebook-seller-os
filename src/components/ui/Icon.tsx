/**
 * Icon.tsx — A tiny inline SVG icon set (no icon dependency, no network fetch, works offline).
 * Icons are hand-drawn 24x24 stroke paths in the style of open-source icon sets.
 */

import type { SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'orders'
  | 'customers'
  | 'products'
  | 'inventory'
  | 'courier'
  | 'payments'
  | 'returns'
  | 'expenses'
  | 'reports'
  | 'settings'
  | 'backup'
  | 'help'
  | 'plus'
  | 'search'
  | 'close'
  | 'edit'
  | 'trash'
  | 'print'
  | 'download'
  | 'upload'
  | 'check'
  | 'warning'
  | 'info'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'menu'
  | 'offline'
  | 'online'
  | 'archive'
  | 'copy'
  | 'filter'
  | 'refresh'
  | 'lock'
  | 'user'
  | 'phone'
  | 'tag'
  | 'chart'
  | 'clock'
  | 'save'
  | 'undo'
  | 'eye';

const PATHS: Record<IconName, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  orders: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 6h6M9 13h6M9 17h4',
  customers: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.87M16.5 4.13a4 4 0 0 1 0 7.75',
  products: 'M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
  inventory: 'M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Zm4 0V5a4 4 0 0 1 8 0v2M9 12h6',
  courier: 'M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  payments: 'M3 7h18v10H3V7Zm0 4h18M7 15h4',
  returns: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  expenses: 'M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  reports: 'M5 20V10M12 20V4M19 20v-7M3 20h18',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10.6 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z',
  backup: 'M12 3v12m0-12 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  help: 'M12 17h.01M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.5-1.5L21 21',
  close: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4Zm9-13 4 4',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6',
  print: 'M7 9V4h10v5M7 19H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 15h10v5H7v-5Z',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  upload: 'M12 21V9m0 0 4 4m-4-4-4 4M4 5h16',
  check: 'M5 13l4 4L19 7',
  warning: 'M12 9v4m0 3h.01M10.3 4.3 2.6 17.6A2 2 0 0 0 4.3 21h15.4a2 2 0 0 0 1.7-3.4L13.7 4.3a2 2 0 0 0-3.4 0Z',
  info: 'M12 11v5m0-8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  offline: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 3.5-2.3M19 13a10 10 0 0 0-7.8-3.8M12 20h.01',
  online: 'M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M2 9.5a15 15 0 0 1 20 0M12 20h.01',
  archive: 'M3 7h18v4H3V7Zm2 4v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M10 12h4',
  copy: 'M9 9h10v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9ZM5 15V5a1 1 0 0 1 1-1h10',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5V11Z',
  user: 'M18 20v-2a4 4 0 0 0-4-4H10a4 4 0 0 0-4 4v2M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  phone: 'M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z',
  tag: 'M20 12.5 12.5 20a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7.6a2 2 0 0 1 1.4.6l6 6a2 2 0 0 1 0 2.8ZM8 8h.01',
  chart: 'M4 20V6m0 14h16M8 20v-6M12 20V9M16 20v-9M20 20V4',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  save: 'M5 4h11l3 3v13H5V4Zm3 0v5h7V4M8 20v-6h8v6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
