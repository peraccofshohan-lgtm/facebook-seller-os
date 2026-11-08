# ARCHITECTURE.md — কোড কীভাবে সাজানো

```
src/
├─ app/                রানটাইম শেল: কনটেক্সট, রাউটিং, বুটস্ট্র্যাপ, এরর বাউন্ডারি
├─ components/
│  ├─ ui/              ডিজাইন সিস্টেম (Button, Card, Field, Modal, Table, Icon…)
│  └─ charts/          সরল SVG চার্ট (কোনো চার্ট লাইব্রেরি নেই)
├─ db/                 Dexie স্কিমা, ডিফল্ট সিড, মাইগ্রেশন রেজিস্ট্রি
├─ domain/             টাইপ, কনস্ট্যান্ট, Zod স্কিমা (ব্যবসায়িক নিয়মের এক জায়গা)
├─ features/           স্ক্রিন (মডিউল অনুযায়ী ফোল্ডার)
├─ finance/            টাকার গণনা (orderTotals, profit) — UI-মুক্ত, বিশুদ্ধ ফাংশন
├─ hooks/              useAsync, usePagination, useOnline, useTaxonomies
├─ lib/                money, date, csv, crypto, search, id, download, image
├─ pwa/                সার্ভিস ওয়ার্কার রেজিস্ট্রেশন
├─ services/           সব ডেটা অ্যাক্সেস ও ব্যবসায়িক কার্যকলাপ (একমাত্র লেখার পথ)
└─ styles/             Tailwind 4 + ডিজাইন টোকেন
```

## ১. স্তর ও নির্ভরতার দিক

```
UI (features/)  →  services/  →  finance/ + lib/ + db/
        ↓                ↓
   components/      domain/
```

- **UI কখনো সরাসরি `db` পড়ে না** (দুই-একটি তালিকা ছাড়া) — সব `services/`-এর মাধ্যমে।
- **`finance/` ও `lib/` বিশুদ্ধ** — কোনো React, কোনো Dexie নির্ভরতা নেই। এজন্য এদের টেস্ট করা সহজ।
- **`domain/`**-এ টাইপ, কনস্ট্যান্ট ও Zod স্কিমা — বাংলা লেবেল ও ভ্যালিডেশন বার্তা এক জায়গায়।

## ২. অ্যাপ বুট হওয়ার ধাপ

```
main.tsx
  └─ registerServiceWorker()            (শুধু প্রোডাকশনে)
  └─ <ErrorBoundary>                    ক্র্যাশ হলে বাংলায় বার্তা + রিলোড
      └─ <ToastProvider>                সফল/ত্রুটি বার্তা
          └─ <AppProvider>              settings + version (ডেটা বদলের কাউন্টার)
              └─ <BrowserRouter>
                  └─ <AppShell>         সাইডবার / নিচের নেভিগেশন / হেডার
                      └─ <Outlet/>      ← রাউট অনুযায়ী পেজ
```

`App.tsx`-এর ভিতরে:

1. `bootstrap()` — ডেটাবেস খোলে, মাইগ্রেশন চালায়, ডিফল্ট সিড করে।
2. `settings.onboardingCompleted === false` হলে `/setup`-এ পাঠায়।
3. পিন লক চালু থাকলে `<LockScreen/>` (অ্যাপের বাকি অংশ রেন্ডার হয় না)।

## ৩. ডেটা প্রবাহ

**পড়া:** পেজ → `useAsync(query, deps)` → `service.list*()` → Dexie → স্টেট → টেবিল/কার্ড।
`deps`-এ সবসময় `version` থাকে, তাই যেকোনো মিউটেশনের পর তালিকা স্বয়ংক্রিয়ভাবে রিফ্রেশ হয়।

**লেখা:** পেজ → Zod (ঐচ্ছিক) → `service.create*/update*()` → `db.transaction('rw', [...])` → `refresh()` (version++)।

### কেন সব লেখা এক ট্রানজেকশনে

একটি অর্ডার মানে: অর্ডার রেকর্ড + স্টক মুভমেন্ট + স্টক লেভেল + পেমেন্ট + ইভেন্ট + নম্বর কাউন্টার। কোনো একটি ব্যর্থ হলে সব বাতিল — অর্ধেক-লেখা অবস্থা থাকতে পারে না।

> **Dexie সতর্কতা:** `db.transaction('rw', a, b, c, d, e, f)` সর্বোচ্চ ৫ টেবিল নেয়। এর বেশি হলে **অ্যারে ফর্ম** ব্যবহার করতে হয়:
> ```ts
> await db.transaction('rw', [db.orders, db.payments, db.stockLevels, ...], async () => { … });
> ```
> ট্রানজেকশনের ভিতরে এমন কোনো টেবিল স্পর্শ করা যাবে না যা তালিকায় নেই — Dexie `NotFoundError` দেয়। (এই ভুল দুই জায়গায় ধরা পড়েছিল এবং টেস্টে ঠিক করা হয়েছে।)

## ৪. টাকার মডেল (অত্যন্ত গুরুত্বপূর্ণ)

- সব টাকা **পূর্ণসংখ্যা পয়সা** (`type Minor = number`)। `1200.50` টাকা = `120050`।
- কোনো স্থানেই `float` যোগ-বিয়োগ নেই; `parseMoney()` স্ট্রিং থেকে পয়সায় রূপান্তর করে (বাংলা/লাতিন সংখ্যা দুটোই চলে)।
- ভাগ করতে হলে `allocate()` / `allocateByWeights()` ব্যবহার করতে হয় — বাকি পয়সা ভাগ করে দেওয়া হয়, যোগফল কখনো বদলায় না।

## ৫. তারিখ ও সময়

- সব তারিখ `Asia/Dhaka` অনুযায়ী হিসাব করা হয় (`src/lib/date.ts`)।
- রেঞ্জ হলো `[from, to)` — অর্থাৎ `to` হলো **পরের দিনের শুরু** (exclusive)।
- ডেটাবেসে `epoch milliseconds`; `<input type="date">`-এর সাথে `toDateInputValue`/`fromDateInputValue` দিয়ে রূপান্তর।

## ৬. রাউটিং

`react-router-dom` v6, `BrowserRouter`। রুট টেবিল `src/app/App.tsx`-এ; নেভিগেশন আইটেম `src/app/nav.ts`-এ (আইকন + বাংলা লেবেল এক জায়গায়)।

| পাথ | পেজ |
|---|---|
| `/` | Dashboard |
| `/orders`, `/orders/new`, `/orders/:id`, `/orders/:id/edit` | Orders |
| `/customers`, `/customers/new`, `/customers/:id` | Customers |
| `/products`, `/products/new`, `/products/:id` | Products |
| `/inventory` | Inventory |
| `/courier` | Courier |
| `/payments` | Payments |
| `/returns` | Returns |
| `/expenses` | Expenses |
| `/reports` | Reports |
| `/backup` | Backup / Import / Export |
| `/settings` | Settings |
| `/setup` | প্রথম-বারের সেটআপ |
| `/help` | ব্যবহারবিধি |
| `*` | 404 |

## ৭. ডিজাইন সিস্টেম

`src/components/ui/` — সব বাংলা-প্রথম, মোবাইল-প্রথম:

- `Button`, `LinkButton`, `IconButton`
- `Card`, `CardHeader`, `CardBody`, `StatCard`
- `Field` (render-prop: `<Field label>{({id}) => <Input id={id}/>}</Field>`), `Input`, `Textarea`, `Select`, `Checkbox`
- `Modal`, `ConfirmDialog`
- `DataTable` + `Pagination` (মোবাইলে কার্ড লেআউটে বদলায়), `SearchInput`, `Tabs`, `MoneyInput`, `DateRangePicker`
- `Toast`, `ErrorBanner`, `WarningBanner`, `InfoBanner`, `EmptyState`, `Skeleton`
- `Icon` — ইনলাইন SVG, কোনো বাহ্যিক আইকন প্যাকেজ নেই (অফলাইনে নিশ্চিত)

রঙ/টাইপোগ্রাফি টোকেন `src/styles/index.css`-এ; প্রিন্ট শিট `.print-sheet` / `.no-print`।

## ৮. কেন কোনো রাষ্ট্রীয়/বৈশ্বিক স্টেট লাইব্রেরি নেই

প্রয়োজনীয় স্টেট মাত্র তিন ধরনের:

1. **সার্ভার(ডেটাবেস) স্টেট** — `useAsync` + `version` কাউন্টার দিয়ে সমাধান।
2. **সেটিংস** — `AppProvider`।
3. **ফর্ম স্টেট** — `useState`।

Redux/Zustand/React Query যোগ করলে বান্ডেল বাড়ত, জটিলতা বাড়ত, লাভ হতো না।

## ৯. ত্রুটির ধরণ

- **ব্যবহারকারীর ভুল** (স্টক নেই, সঠিক ফোন নয়) → বাংলায় বার্তা, `ErrorBanner` / টোস্ট। ট্রানজেকশন বাতিল।
- **প্রোগ্রামার ভুল** (অবৈধ স্টেট) → `ErrorBoundary`: বাংলায় ক্ষমা চেয়ে "রিলোড করুন" (ডেটা অক্ষত থাকে)।
- **ডেটাবেস সমস্যা** (কোটা/ব্লক) → স্পষ্ট বার্তা ও ব্যাকআপের পরামর্শ।

## ১০. নির্ভরতা (সব মুক্ত লাইসেন্সের)

`react`, `react-dom`, `react-router-dom`, `dexie`, `dexie-react-hooks`, `zod` — রানটাইমে।
`vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `typescript`, `vite-plugin-pwa`, `vitest`, `@testing-library/*`, `fake-indexeddb`, `jsdom`, `eslint`, `typescript-eslint`, `playwright`, `sharp` (শুধু আইকন তৈরিতে)।

**ইচ্ছে করেই বাদ:** কোনো UI কিট, কোনো চার্ট লাইব্রেরি, কোনো PDF ইঞ্জিন, কোনো ডেট-ফরম্যাটিং লাইব্রেরি, কোনো স্টেট ম্যানেজার।
