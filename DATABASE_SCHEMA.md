# DATABASE_SCHEMA.md — টেবিল, ক্ষেত্র ও ইনডেক্স

**ইঞ্জিন:** IndexedDB, [Dexie](https://dexie.org) 4-এর মাধ্যমে
**ডেটাবেসের নাম:** `facebook-seller-os`
**স্কিমা সংস্করণ (Dexie):** `1` · **অ্যাপ-লেভেল `schemaVersion`:** `1`
**সংজ্ঞা:** `src/db/db.ts` · **টাইপ:** `src/domain/types.ts`

---

## ১. সাধারণ নিয়ম

- প্রতিটি টেবিলের প্রাথমিক কী `id` (স্ট্রিং, `randomId()` — টাইমস্ট্যাম্প + র‍্যান্ডম)।
- সব রেকর্ডে `createdAt`, `updatedAt` (epoch ms)।
- ব্যবসায়িক রেকর্ডে `archivedAt: number | null` — **কখনো স্থায়ীভাবে মোছা হয় না** (আর্কাইভ করাই ডিফল্ট)।
- শক্ত-ডিলিট (`hardDelete*`) তখনই সম্ভব, যখন কোনো রেফারেন্স নেই — আগে `checkHardDelete()`/`checkOrderDelete()` দিয়ে যাচাই করা হয়।
- টাকা = পূর্ণসংখ্যা পয়সা (`Minor`)। তারিখ = epoch ms (`Timestamp`)।

```
┌── settings ──┐        ┌── products ──┐        ┌── customers ──┐
│ id: 'app'    │        │              │        │               │
└──────────────┘        └──────┬───────┘        └───────┬───────┘
                               │                        │
                        ┌──────▼───────┐                │
                        │productVariants│               │
                        └──────┬───────┘                │
                               │                        │
                     ┌─────────▼─────────┐     ┌────────▼────────┐
                     │   stockLevels     │     │     orders      │
                     │ (প্রতি পণ্য/ভ্যারিয়েন্ট)│◄────┤  (স্ন্যাপশট)    │
                     └─────────▲─────────┘     └────┬────────┬───┘
                               │                    │        │
                     ┌─────────┴─────────┐    ┌─────▼──┐ ┌──▼────────┐
                     │  stockMovements   │    │payments│ │  returns  │
                     │  (লেজার, সইন-সহ)   │    └────────┘ └───────────┘
                     └───────────────────┘          ▲
                                                    │
                        ┌──────────────┐     ┌──────┴───────┐
                        │   expenses   │     │courierRecords│
                        └──────────────┘     └──────────────┘
```

---

## ২. টেবিল

### `settings` — একটিমাত্র রেকর্ড (`id: 'app'`)
অ্যাপের পছন্দ ও কাউন্টার। ক্ষেত্র: `business` (নাম, ফোন, ইমেইল, ওয়েবসাইট, ঠিকানা, লাইসেন্স নোট, লোগো), `currency` (কোড `BDT`, চিহ্ন `৳`, অবস্থান), `locale` (টাইমজোন, তারিখ ফরম্যাট, বাংলা সংখ্যা), `invoice` (প্রিফিক্স, পরবর্তী নম্বর, ফুটার, শর্ত, লোগো দেখানো, কাগজ), `order` (প্রিফিক্স, পরবর্তী নম্বর, ডিফল্ট ডেলিভারি চার্জ `6000`, `stockCommitStatuses`), `inventory` (`defaultLowStockThreshold: 5`, `allowNegativeStock: false`), `security` (`pinEnabled`, `pinRecord`), `backup` (`reminderEnabled`, `reminderDays: 7`, `lastBackupAt`), `onboardingCompleted`, `schemaVersion`।

### `productCategories`, `expenseCategories`, `paymentMethods`, `courierProviders`
ট্যাক্সোনমি। `paymentMethods`-এ `key` (cash/bkash/nagad/rocket/bank/card/cod/other) ও `isActive`; `courierProviders`-এ ফোন, নোট, `isActive`।

### `products`
`name`, `sku`, `description`, `categoryId`, `brand`, `costPrice`, `sellingPrice`, `discountPrice|null`, `unit`, `barcode`, `imageDataUrl|null` (রিসাইজ করা ডেটা URL), `hasVariants`, `lowStockThreshold`, `isActive`, `archivedAt`।

### `productVariants`
`productId`, `sku`, `label`, `size`, `color`, `weight`, `custom`, `costPrice`, `sellingPrice`, `isActive`, `archivedAt`।

### `stockLevels` — ক্যাশ (লেজার থেকে পুনর্গণনাযোগ্য)
`id = ${productId}::${variantId ?? '-'}` (নির্ণায়ক), `productId`, `variantId`, `quantity`, `avgCost` (গড় ক্রয়মূল্য, পয়সা)।

### `stockMovements` — অপরিবর্তনীয় লেজার
`productId`, `variantId`, `quantity` (**সইন-সহ**: ঋণাত্মক = কমা), `type`, `referenceType`, `referenceId`, `unitCost`, `reason`, `party`, `note`, `createdAt`।

`type`: `purchase | opening | sale | sale_reversal | order_edit | return_in | return_out | exchange_in | exchange_out | damage | loss | manual | adjustment | production`
`referenceType`: `order | return | exchange | purchase | manual | adjustment | opening | courier`

### `customers`
`code` (C0001…), `name`, `phone` (নর্মালাইজড `01XXXXXXXXX`), `altPhone`, `address`, `district`, `area`, `notes`, `tags[]`, `status: active|blocked|vip`, `lastOrderAt`, `archivedAt`।

### `orders`
`orderNumber`, `orderDate`, `channel`, `customerId`, **`customerName`/`customerPhone` (স্ন্যাপশট)**, `deliveryAddress`, `items[]`, `subtotal`, `discount`, `deliveryCharge`, `otherCharge`, `total`, `cogs`, `status`, `paymentStatus`, `paymentMethod`, `courierProviderId`, `courierName`, `trackingNumber`, `notes`, `customerInstructions`, `cancelReason`, `stockCommitted`, `returnRestocked`, `codAmount`, `archivedAt`।

### `orderItems` (এমবেডেড অ্যারে)
`productId`, `variantId`, `name`, `sku`, `unit`, `quantity`, `unitPrice`, **`unitCost` (স্ন্যাপশট)**, `discount`, `lineTotal`।

### `orderEvents`
`orderId`, `type` (`created|updated|status|payment|refund|return|note|cancelled|deleted`), `message` (বাংলা), `meta`, `createdAt`।

### `payments`
`kind` (`order_payment|order_refund|courier_payout|cod_collection|expense|adjustment`), `direction` (`in|out`), `amount`, `method`, `orderId|null`, `customerId|null`, `courierRecordId|null`, `expenseId|null`, `date`, `reference`, `note`, `voidedAt`, `archivedAt`।

### `courierRecords`
`providerId`, `courierName`, `consignmentId`, `orderId`, `shipmentDate`, `status` (`pending|in_transit|delivered|partial_delivered|cancelled|returned|lost|hold`), `deliveryCharge`, `customerDeliveryCharge`, `codAmount`, `collectedAmount`, `courierFee`, `returnFee`, `adjustment`, `payoutDate`, `payoutReference`, `note`।

### `returns`
`returnNumber`, `orderId`, `type` (`return|exchange|refund_only`), `date`, `reason`, `condition` (`resellable|damaged|defective|missing_parts`), `items[]`, `refundAmount`, `courierFee`, `status` (`completed|cancelled`), `refundPaymentId`, `previousOrderStatus`, `note`।

### `expenses`
`expenseNumber`, `date`, `categoryId`, `categoryName` (স্ন্যাপশট), `amount`, `method`, `payee`, `reference`, `description`, `note`, **`courierRecordId|null`** (দ্বিগুণ হিসাব রোধ), `voidedAt`।

---

## ৩. ইনডেক্স

| টেবিল | ইনডেক্স |
|---|---|
| `settings` | `id` |
| `productCategories` / `expenseCategories` | `id, name, createdAt` |
| `paymentMethods` | `id, key, name, isActive` |
| `courierProviders` | `id, name, isActive` |
| `products` | `id, sku, name, categoryId, isActive, archivedAt, createdAt, updatedAt` |
| `productVariants` | `id, productId, sku, [productId+sku], isActive` |
| `stockLevels` | `id, productId, variantId, [productId+variantId], quantity` |
| `stockMovements` | `id, productId, variantId, [productId+variantId], type, referenceType, referenceId, createdAt` |
| `customers` | `id, code, name, phone, status, archivedAt, createdAt, updatedAt` |
| `orders` | `id, orderNumber, orderDate, status, customerId, channel, paymentStatus, courierProviderId, trackingNumber, archivedAt, createdAt, updatedAt` |
| `orderEvents` | `id, orderId, type, createdAt, [orderId+createdAt]` |
| `payments` | `id, orderId, customerId, courierRecordId, expenseId, kind, direction, date, createdAt` |
| `courierRecords` | `id, consignmentId, orderId, providerId, status, shipmentDate, createdAt` |
| `returns` | `id, returnNumber, orderId, type, status, date, createdAt` |
| `expenses` | `id, expenseNumber, date, categoryId, categoryName, method, voidedAt, createdAt` |

**কেন এই ইনডেক্স:** রেঞ্জ-ভিত্তিক রিপোর্ট `orderDate`/`date`/`shipmentDate` দিয়ে কুয়েরি করে; লুক-আপ `orderId`, `customerId`, `courierRecordId`, `referenceId` দিয়ে হয়; `[productId+variantId]` স্টক লুক-আপের জন্য।

---

## ৪. রেফারেন্সিয়াল অখণ্ডতা

| সম্পর্ক | নিয়ম |
|---|---|
| `order.customerId → customers.id` | কাস্টমার মোছা হয় না, আর্কাইভ হয়; অর্ডারে নাম/ফোন স্ন্যাপশট থাকে |
| `order.items[].productId → products.id` | পণ্য আর্কাইভ হতে পারে; মুছতে গেলে `checkHardDelete()` বাধা দেয় |
| `stockMovements.referenceId → orders/returns` | অর্ডার মুছতে গেলে `checkOrderDelete()` বাধা দেয় |
| `payments.orderId → orders.id` | পেমেন্ট থাকলে অর্ডার মোছা যাবে না |
| `courierRecords.orderId → orders.id` | ঐচ্ছিক লিংক |
| `expenses.courierRecordId → courierRecords.id` | এক কুরিয়ারে সর্বোচ্চ একটি খরচ (দ্বিগুণ রোধ) |
| `stockLevels` | `stockMovements` থেকে পুনর্গণনাযোগ্য ক্যাশ |

---

## ৫. আকার ও কর্মদক্ষতা

- সাধারণ ব্যবহার (কয়েক হাজার অর্ডার) IndexedDB স্বাচ্ছন্দ্যে সামলায়।
- তালিকা সবসময় পেজিনেটেড (২৫/৫০/১০০), রিপোর্টে সর্বোচ্চ ৫০০ সারি।
- পণ্যের ছবি রিসাইজ করে (সর্বোচ্চ ~২৪০–৫১২ px) ডেটা URL হিসেবে রাখা হয় — ডেটাবেস ফুলে যাওয়া রোধ।
- বড় ডেটাবেসে সবচেয়ে ভারী অংশ হলো স্টক লেজার; এটি কখনো মোছা হয় না, তাই স্টক মুভমেন্ট এক্সপোর্ট/আর্কাইভ করার সুপারিশ করা হয়।
