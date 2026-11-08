# DEPLOYMENT.md — কোথায় ও কীভাবে হোস্ট করবেন

এই অ্যাপটি একটি **সম্পূর্ণ স্ট্যাটিক সাইট**: বিল্ডের পর `dist/`-এ শুধু HTML, CSS, JS, আইকন ও একটি সার্ভিস ওয়ার্কার থাকে। কোনো সার্ভার কোড, কোনো ডেটাবেস সার্ভার, কোনো API নেই। তাই যেকোনো স্ট্যাটিক হোস্টিং-এ চলে।

---

## ১. বিল্ড

```bash
npm ci
npm run icons          # public/icons/* তৈরি (প্রথমবার বাধ্যতামূলক)
npm run build          # tsc --noEmit + vite build → dist/
npm run preview        # স্থানীয়ভাবে dist/ যাচাই: http://localhost:4173
```

`npm run build` ব্যর্থ হলে ডেপলয় করবেন না — বিল্ডেই টাইপচেক চলে।

### বিল্ডের আউটপুট

```
dist/
├── index.html
├── manifest.webmanifest
├── sw.js  +  workbox-*.js          # সার্ভিস ওয়ার্কার (অফলাইন)
├── assets/*.js, *.css
├── icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, icon.svg
└── favicon.ico
```

আকার (v1.0.0): মোট ~৭৯০ kB precache; JS gzip-এ ~১১০ kB + React ~৫৪ kB + Dexie ~৩৩ kB।

---

## ২. হোস্টিংয়ের শর্ত (অ-আলোচনাযোগ্য)

| শর্ত | কেন |
|---|---|
| **HTTPS** | সার্ভিস ওয়ার্কার ও PWA ইনস্টল কাজ করে না (localhost ছাড়া) |
| **SPA fallback** (`/*` → `index.html`) | `/orders/123` সরাসরি খুললে ৪০৪ দিলে রিফ্রেশ কাজ করবে না |
| **ক্যাশ হেডার:** `index.html` ও `sw.js` → `no-cache`; `assets/*` → দীর্ঘমেয়াদি | নতুন সংস্করণ সবাই পাবে; পুরনো অ্যাসেট ক্যাশ থেকে |
| **কোনো কম্প্রেশন বাধ্যতামূলক নয়**, কিন্তু gzip/brotli দিলে লোড দ্রুত | — |
| **কোনো এনভায়রনমেন্ট ভ্যারিয়েবল নেই** | অ্যাপে কোনো সিক্রেট বা কনফিগ নেই; `.env` লাগে না |

> ⚠️ **কোনো বেস পাথ ধরে নেওয়া হয়নি:** অ্যাপটি ডোমেইনের রুটে (`/`) ডেপলয়ের জন্য তৈরি। সাব-পাথে (যেমন `/app/`) চালাতে হলে `vite.config.ts`-এ `base: '/app/'` সেট করে আবার বিল্ড করতে হবে।

---

## ৩. বিনামূল্যের বিকল্প (কোনো পেইড সার্ভিস ছাড়া)

### GitHub Pages (প্রস্তাবিত শুরুতে)
1. `.github/workflows/deploy.yml` তৈরি করুন:
   ```yaml
   name: Deploy
   on:
     push: { branches: [main] }
   permissions: { contents: read, pages: write, id-token: write }
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20', cache: npm }
         - run: npm ci
         - run: npm run icons
         - run: npm run build
         - uses: actions/upload-pages-artifact@v3
           with: { path: dist }
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```
2. Settings → Pages → Source: **GitHub Actions**।
3. ⚠️ GitHub Pages সাব-পাথ (`https://user.github.io/repo/`) ব্যবহার করে — `vite.config.ts`-এ `base: '/repo/'` সেট করুন। SPA fallback-ও নেই; প্রয়োজনে `404.html` কপি করে `index.html` বানান।

### Netlify (ড্রপ-ইন)
- `dist/` ফোল্ডার টেনে দিন, অথবা Git কানেক্ট করে:
  - Build command: `npm run icons && npm run build`
  - Publish directory: `dist`
- SPA fallback স্বয়ংক্রিয়ভাবে চালু রাখতে `public/_redirects` ফাইল:
  ```
  /*    /index.html   200
  ```

### Cloudflare Pages
- Build command: `npm run icons && npm run build`
- Output directory: `dist`
- Headers (`public/_headers`):
  ```
  /index.html
    Cache-Control: no-cache
  /sw.js
    Cache-Control: no-cache
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```

### Vercel
- Framework preset: **Vite**; Build: `npm run icons && npm run build`; Output: `dist`।
- SPA fallback ডিফল্টভাবে কাজ করে।

### নিজস্ব সার্ভার (Nginx)
```nginx
server {
  listen 443 ssl http2;
  server_name example.com;
  root /var/www/seller-os;
  index index.html;

  # SPA fallback
  location / { try_files $uri $uri/ /index.html; }

  # Never cache the entry point or the service worker
  location = /index.html { add_header Cache-Control "no-cache, must-revalidate"; }
  location = /sw.js      { add_header Cache-Control "no-cache, must-revalidate"; }

  # Immutable, hashed assets
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
}
```

---

## ৪. ডেপলয়ের পর যাচাই (চেকলিস্ট)

```bash
# সার্ভার চালু থাকাকালীন
curl -sI https://your-domain/ | head -5                 # 200
curl -s  https://your-domain/manifest.webmanifest      # JSON
curl -sI https://your-domain/sw.js                     # 200 + no-cache
curl -sI https://your-domain/icons/icon-192.png        # 200
curl -s  https://your-domain/orders | head -3          # index.html (SPA fallback)
```

ব্রাউজারে:
1. DevTools → Application → Manifest: কোনো ত্রুটি নেই।
2. Application → Service Workers: **activated**।
3. Lighthouse → PWA: *Installable*।
4. ইনস্টল → বন্ধ করে আবার খুলুন (অফলাইনে চলে)।
5. **নেটওয়ার্ক বন্ধ করে রিলোড** — অ্যাপ চালু হবে।

---

## ৫. আপডেট ডেপলয়

1. নতুন কোড → `npm run build` → `dist/` ডেপলয়।
2. ব্যবহারকারীর অ্যাপে বাংলায় ব্যানার: "নতুন সংস্করণ পাওয়া গেছে — রিলোড করুন"।
3. **তথ্য অক্ষত থাকে** (তথ্য IndexedDB-তে, ক্যাশে নয়)।
4. পুরনো ক্যাশ `cleanupOutdatedCaches: true` দিয়ে স্বয়ংক্রিয়ভাবে মোছা হয়।

সংস্করণ বদলাতে `package.json`-এর `version` **এবং** `vite.config.ts`-এর `APP_VERSION` একসাথে বদলাতে হবে (অ্যাপের "সম্পর্কে" পেজে এটি দেখায়)।

---

## ৬. রোলব্যাক

`dist/` স্ট্যাটিক, তাই রোলব্যাক মানে আগের বিল্ডটি আবার ডেপলয় করা। ব্রাউজার ক্যাশে পুরনো অ্যাসেট থাকতে পারে — `index.html` `no-cache` হওয়ায় নতুন রেফারেন্স সাথে সাথে আসে।

---

## ৭. যা যা নেই (সৎ তালিকা)

- কোনো ব্যাকএন্ড/সার্ভার-সাইড রেন্ডারিং নেই।
- কোনো ডেটাবেস সার্ভার বা ক্লাউড স্টোরেজ নেই — সব তথ্য ব্যবহারকারীর ডিভাইসে।
- কোনো স্বয়ংক্রিয় ডেপলয় এই রিপোজিটরিতে কনফিগার করা নেই (উপরের উদাহরণ দিয়ে নিজে যোগ করতে পারবেন)।
- কোনো কাস্টম ডোমেইন, SSL সার্টিফিকেট বা CDN এই প্রকল্পের অংশ নয় — হোস্টিং প্রোভাইডারের বিষয়।
