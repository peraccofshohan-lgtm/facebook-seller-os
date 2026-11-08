# Facebook Seller OS

**ফেসবুক ও অনলাইন বিক্রেতাদের জন্য একটি সম্পূর্ণ অফলাইন-ফার্স্ট ব্যবসা ব্যবস্থাপনা অ্যাপ।**

একটি ইনস্টলযোগ্য PWA (Progressive Web App): অর্ডার, কাস্টমার, পণ্য, স্টক, কুরিয়ার, COD হিসাব, রিটার্ন, খরচ, লাভ-ক্ষতি, রিপোর্ট, CSV ইমপোর্ট/এক্সপোর্ট ও ব্যাকআপ — সব কিছু আপনার ডিভাইসেই। কোনো সার্ভার, কোনো সাবস্ক্রিপশন, কোনো বিজ্ঞাপন নেই।

- **ভাষা:** সব ইন্টারফেস সহজ প্রাকৃতিক বাংলায়
- **মুদ্রা:** BDT (টাকা), সময় অঞ্চল `Asia/Dhaka`
- **ডেটা:** ব্রাউজারের IndexedDB-তে (Dexie) — আপনার ডিভাইসেই থাকে
- **অফলাইন:** ইন্টারনেট ছাড়া সব কাজ চলে

---

## দ্রুত শুরু

```bash
git clone <repository-url>
cd facebook-seller-os
npm install
npm run icons      # PWA আইকন তৈরি (প্রথমবার)
npm run dev        # http://localhost:5173
```

প্রোডাকশন বিল্ড ও প্রিভিউ:

```bash
npm run build      # tsc --noEmit + vite build
npm run preview    # http://localhost:4173
```

সব যাচাই একসাথে:

```bash
npm run verify:release   # typecheck + lint + test + build
```

Node.js 20 বা তার উপরে লাগবে।

## ফোনে ইনস্টল (Android/Chrome)

1. Chrome-এ অ্যাপটি খুলুন (HTTPS বা localhost)
2. উপরের ডানদিকের ⋮ মেনু → **অ্যাপ ইনস্টল করুন**
3. হোম স্ক্রিনে আইকন আসবে — ইন্টারনেট ছাড়াও চলবে

Windows/Mac: Chrome/Edge-এর ঠিকানা বারের **ইনস্টল** আইকন, অথবা Safari → Share → Add to Dock।

## মডিউল এক নজরে

| মডিউল | যা করা যায় |
|---|---|
| ড্যাশবোর্ড | আজ/সপ্তাহ/মাসের বিক্রয়, আদায়, বাকি, COD, লাভ, কম-স্টক সতর্কতা |
| অর্ডার | নতুন অর্ডার, স্ট্যাটাস, পেমেন্ট, কপি, আর্কাইভ, ইনভয়েস প্রিন্ট/PDF |
| কাস্টমার | প্রোফাইল, ট্যাগ, লাইফটাইম হিসাব, ডুপ্লিকেট সতর্কতা |
| পণ্য | ক্রয়/বিক্রয় মূল্য, SKU, ক্যাটেগরি, ভ্যারিয়েন্ট, ছবি, আর্কাইভ |
| ইনভেন্টরি | স্টক লেজার, সমন্বয়, স্টক মূল্য, পুনর্গণনা |
| কুরিয়ার | কনসাইনমেন্ট, COD হিসাব মিলানো, পারফরম্যান্স |
| পেমেন্ট/COD | সব লেনদেন, বাকি খাতা, মাধ্যম অনুযায়ী হিসাব |
| রিটার্ন | রিটার্ন/এক্সচেঞ্জ/রিফান্ড, রিস্টক, বাতিল |
| খরচ | খাত অনুযায়ী খরচ, বাতিল, কুরিয়ার খরচ সিঙ্ক |
| লাভ-ক্ষতি | আনুমানিক ও বাস্তবায়িত লাভ, খরচের বিবরণ |
| রিপোর্ট | ১২ ধরনের রিপোর্ট, চার্ট, CSV |
| ইমপোর্ট/এক্সপোর্ট | CSV (এক্সেল/গুগল শিট) — প্রিভিউ সহ |
| ব্যাকআপ/রিস্টোর | JSON, ঐচ্ছিক পাসওয়ার্ড এনক্রিপশন, মার্জ/রিপ্লেস |
| সেটিংস | ব্যবসা, নম্বর, ক্যাটেগরি, পিন লক, ডেটা |

## গুরুত্বপূর্ণ নীতি

1. **টাকা সবসময় পূর্ণসংখ্যায় (পয়সা)** — কখনো float নয়। `0.1 + 0.2` সমস্যা এই অ্যাপে অসম্ভব।
2. **কোনো ফেইক ফিচার নেই** — কোনো বোতাম কাজ করে না এমন নয়, কোনো ডেমো/হার্ডকোডেড সংখ্যা নেই।
3. **তথ্য কোথাও পাঠানো হয় না** — কোনো সার্ভার কল, কোনো অ্যানালিটিক্স, কোনো বিজ্ঞাপন নেই।
4. **ব্যাকআপই একমাত্র সুরক্ষা** — ডিভাইস হারালে ব্যাকআপ ছাড়া তথ্য ফেরত পাওয়া যাবে না।

## ডকুমেন্টেশন

| ডকুমেন্ট | বিষয় |
|---|---|
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | কী কী আছে, কী নেই, কেন |
| [ARCHITECTURE.md](ARCHITECTURE.md) | কোড কীভাবে সাজানো |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | টেবিল ও ইনডেক্স |
| [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) | স্কিমা বদলের নিয়ম |
| [FINANCIAL_RULES.md](FINANCIAL_RULES.md) | টাকার হিসাবের সব নিয়ম |
| [OFFLINE_PWA.md](OFFLINE_PWA.md) | অফলাইন কীভাবে কাজ করে |
| [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) | নিরাপত্তা ও গোপনীয়তা — সীমাবদ্ধতা সহ |
| [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) | ব্যাকআপ নেওয়া ও ফেরত আনা |
| [TESTING.md](TESTING.md) | টেস্ট চালানো ও কী ঢাকা আছে |
| [AUDIT_REPORT_BN.md](AUDIT_REPORT_BN.md) | প্রকাশের আগের স্বাধীন নিরীক্ষা — কী যাচাই হয়েছে, কী হয়নি, কী ঠিক করা হয়েছে |
| [DEPLOYMENT.md](DEPLOYMENT.md) | কোথায় ও কীভাবে হোস্ট করবেন |
| [USER_GUIDE_BN.md](USER_GUIDE_BN.md) | বাংলায় পুরো ব্যবহারবিধি |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | কীভাবে বানানো হয়েছে, পরের পরিকল্পনা |
| [CHANGELOG.md](CHANGELOG.md) | সংস্করণ ইতিহাস |
| [LICENSES_AND_ATTRIBUTIONS.md](LICENSES_AND_ATTRIBUTIONS.md) | লাইসেন্স ও ক্রেডিট |

## ডেভেলপার কমান্ড

| কমান্ড | কাজ |
|---|---|
| `npm run dev` | ডেভ সার্ভার |
| `npm run build` | টাইপচেক + প্রোডাকশন বিল্ড |
| `npm run preview` | বিল্ড প্রিভিউ |
| `npm run typecheck` | TypeScript যাচাই |
| `npm run lint` | ESLint (সতর্কতা ০) |
| `npm test` | সব Vitest প্রজেক্ট (unit + integration + UI) |
| `npm run test:unit` / `test:integration` | আলাদা প্রজেক্ট |
| `npm run test:e2e` | Playwright (আগে `npm run build` লাগবে) |
| `npm run icons` | PWA আইকন তৈরি |
| `npm run verify:release` | সব যাচাই একসাথে |

## লাইসেন্স

MIT — বিস্তারিত [LICENSES_AND_ATTRIBUTIONS.md](LICENSES_AND_ATTRIBUTIONS.md)।
