# LICENSES_AND_ATTRIBUTIONS.md — লাইসেন্স ও ক্রেডিট

## ১. এই প্রকল্পের লাইসেন্স

**MIT License**

Copyright (c) 2026 Facebook Seller OS contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## ২. নির্ভরতার লাইসেন্স

সব নির্ভরতা মুক্ত ও বাণিজ্যিকভাবে ব্যবহারযোগ্য লাইসেন্সের। কোনো কপিলেফট (GPL/AGPL) নির্ভরতা নেই।

### রানটাইম (ব্রাউজারে যায়)

| প্যাকেজ | লাইসেন্স | কেন |
|---|---|---|
| `react` | MIT | UI লাইব্রেরি |
| `react-dom` | MIT | DOM রেন্ডারিং |
| `react-router-dom` | MIT | রাউটিং |
| `dexie` | Apache-2.0 | IndexedDB আবরণ |
| `dexie-react-hooks` | Apache-2.0 | Dexie React হুক (সীমিত ব্যবহার) |
| `zod` | MIT | ইনপুট যাচাই |

### ডেভেলপমেন্ট/বিল্ড (ব্রাউজারে যায় না)

| প্যাকেজ | লাইসেন্স | কেন |
|---|---|---|
| `vite` | MIT | বিল্ড টুল |
| `@vitejs/plugin-react` | MIT | React JSX ট্রান্সফর্ম |
| `tailwindcss`, `@tailwindcss/vite` | MIT | CSS |
| `typescript` | Apache-2.0 | টাইপ |
| `vite-plugin-pwa` | MIT | সার্ভিস ওয়ার্কার/ম্যানিফেস্ট |
| `workbox-*` (ট্রানজিটিভ) | MIT | সার্ভিস ওয়ার্কার রানটাইম |
| `vitest`, `@vitest/coverage-v8` | MIT | টেস্ট রানার |
| `@testing-library/react`, `/dom`, `/user-event` | MIT | UI টেস্ট |
| `jsdom` | MIT | DOM পরিবেশ |
| `fake-indexeddb` | Apache-2.0 | Node-এ IndexedDB |
| `@playwright/test` | Apache-2.0 | ই২ই টেস্ট |
| `eslint`, `typescript-eslint`, `globals` | MIT | লিন্ট |
| `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` | MIT | React লিন্ট |
| `sharp` | Apache-2.0 | শুধু `npm run icons`-এ (PNG আইকন) |
| `@types/*` | MIT | টাইপ ডেফিনিশন |

`npm ls --omit=dev --all` ও `npm ls --include=dev` দিয়ে যেকোনো সময় পুরো গাছ দেখা যায়; লাইসেন্স যাচাই করতে:

```bash
npx license-checker --production --summary      # (ঐচ্ছিক টুল, রিপোর প্রয়োজনে)
```

---

## ৩. অ্যাসেট ও ট্রেডমার্ক

- **আইকন:** অ্যাপের সব আইকন এই প্রকল্পের জন্যই আঁকা ইনলাইন SVG (`src/components/ui/Icon.tsx`)। কোনো তৃতীয়-পক্ষ আইকন প্যাক (Font Awesome, Heroicons ইত্যাদি) ব্যবহার করা হয়নি।
- **PWA আইকন/লোগো:** `scripts/generate-icons.mjs` দিয়ে ইনলাইন SVG থেকে তৈরি; সবুজ বর্গক্ষেত্রে একটি "S" মনোগ্রাম। কোনো বিদ্যমান লোগো ব্যবহার করা হয়নি।
- **ফন্ট:** কোনো ওয়েবফন্ট ব্যবহার করা হয়নি — সিস্টেম ফন্ট স্ট্যাক (`system-ui, "Noto Sans Bengali", sans-serif`)। বাংলা টেক্সট ব্যবহারকারীর ডিভাইসের ফন্টে রেন্ডার হয়।
- **কোনো স্টক ছবি নেই।**

### ট্রেডমার্ক বিষয়ক স্পষ্টীকরণ

- "Facebook" নামটি শুধু **বর্ণনামূলকভাবে** ব্যবহার করা হয়েছে (ফেসবুক-ভিত্তিক বিক্রেতার জন্য)। এই প্রকল্পের সাথে Meta Platforms, Inc.-এর **কোনো সম্পর্ক, অনুমোদন বা সংযোগ নেই**।
- ডিফল্ট তালিকায় থাকা কুরিয়ার নাম (পাঠাও, স্টেডফাস্ট, রেডএক্স ইত্যাদি), পেমেন্ট মাধ্যম (বিকাশ, নগদ, রকেট) ও অন্যান্য ব্র্যান্ড — এগুলো **শুধু ব্যবহারকারীর সুবিধার জন্য পূর্বনির্ধারিত টেক্সট**; ব্যবহারকারী যেকোনো সময় বদলাতে বা মুছতে পারে। কোনো সংযোগ, অনুমোদন বা দাবি নেই। এগুলোর মালিকানা সংশ্লিষ্ট কোম্পানির।
- কোনো কোম্পানির লোগো, ট্রেড ড্রেস বা কপিরাইট করা উপাদান অন্তর্ভুক্ত নেই।

---

## ৪. গোপনীয়তা-সম্পর্কিত ঘোষণা

- কোনো তৃতীয়-পক্ষ স্ক্রিপ্ট, ফন্ট, CDN বা ট্র্যাকার অন্তর্ভুক্ত নেই।
- কোনো টেলিমেট্রি, অ্যানালিটিক্স বা ক্র্যাশ রিপোর্টিং নেই।
- বিস্তারিত: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)

---

## ৫. অবদান ও ক্রেডিট

- ডিজাইন, বাস্তবায়ন ও বাংলা কন্টেন্ট: প্রকল্পের অবদানকারীরা।
- প্রশ্ন/সমস্যা: রিপোজিটরিতে ইস্যু খুলুন।

## ৬. তৃতীয়-পক্ষের কোড সরাসরি অন্তর্ভুক্ত?

না। কোনো কপি-পেস্ট করা তৃতীয়-পক্ষ সোর্স ফাইল এই রিপোজিটরিতে নেই; সব নির্ভরতা npm থেকে আসে এবং উপরের তালিকায় আছে।
