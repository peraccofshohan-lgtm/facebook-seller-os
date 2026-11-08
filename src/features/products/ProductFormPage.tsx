import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/Controls';
import { ErrorBanner, Skeleton, WarningBanner } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { useAsync } from '@/hooks/useAsync';
import { useAppContext } from '@/app/AppContext';
import { useProductCategories } from '@/hooks/useTaxonomies';
import {
  createProduct,
  createVariant,
  deleteVariant,
  getProduct,
  isSkuTaken,
  listVariants,
  updateProduct,
  updateVariant,
} from '@/services/productService';
import { adjustStock } from '@/services/inventoryService';
import { productInputSchema, variantInputSchema, zodErrorMap } from '@/domain/schemas';
import { DEFAULT_UNITS } from '@/domain/constants';
import { randomId } from '@/lib/id';
import { resizeImageFile } from '@/lib/image';
import type { ProductVariant } from '@/domain/types';

interface VariantDraft {
  id: string;
  persistedId?: string;
  label: string;
  sku: string;
  size: string;
  color: string;
  weight: string;
  custom: string;
  costPrice: number;
  sellingPrice: number;
  openingStock: number;
}

const emptyVariant = (): VariantDraft => ({
  id: randomId(),
  label: '',
  sku: '',
  size: '',
  color: '',
  weight: '',
  custom: '',
  costPrice: 0,
  sellingPrice: 0,
  openingStock: 0,
});

export default function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refresh, settings, version } = useAppContext();
  const categories = useProductCategories();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState('পিস');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [costPrice, setCostPrice] = useState(0);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [discountPrice, setDiscountPrice] = useState(0);
  const [lowStockThreshold, setLowStockThreshold] = useState(settings?.inventory.defaultLowStockThreshold ?? 5);
  const [isActive, setIsActive] = useState(true);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [hasVariants, setHasVariants] = useState(false);
  const [openingStock, setOpeningStock] = useState(0);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [existingVariants, setExistingVariants] = useState<ProductVariant[]>([]);
  const [skuWarning, setSkuWarning] = useState<string | null>(null);

  const existing = useAsync(() => (id ? getProduct(id) : Promise.resolve(undefined)), [id]);
  const existingVariantState = useAsync(() => (id ? listVariants(id) : Promise.resolve([])), [id, version]);

  useEffect(() => {
    const product = existing.data;
    if (!product) return;
    setName(product.name);
    setSku(product.sku);
    setCategoryId(product.categoryId ?? '');
    setBrand(product.brand);
    setUnit(product.unit);
    setBarcode(product.barcode);
    setDescription(product.description);
    setCostPrice(product.costPrice);
    setSellingPrice(product.sellingPrice);
    setDiscountPrice(product.discountPrice ?? 0);
    setLowStockThreshold(product.lowStockThreshold);
    setIsActive(product.isActive);
    setImageDataUrl(product.imageDataUrl);
    setHasVariants(product.hasVariants);
  }, [existing.data]);

  useEffect(() => {
    setExistingVariants(existingVariantState.data ?? []);
  }, [existingVariantState.data]);

  if (id && existing.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    setErrors({});
    const payload = {
      name,
      sku,
      categoryId: categoryId || null,
      brand,
      unit,
      barcode,
      description,
      costPrice,
      sellingPrice,
      discountPrice: discountPrice > 0 ? discountPrice : null,
      lowStockThreshold,
      isActive,
      imageDataUrl,
      hasVariants,
    };
    const parsed = productInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(zodErrorMap(parsed.error));
      return;
    }
    if (parsed.data.sku && (await isSkuTaken(parsed.data.sku, id))) {
      setErrors({ sku: 'এই SKU ইতিমধ্যে ব্যবহৃত হয়েছে' });
      return;
    }

    setSaving(true);
    try {
      let productId = id;
      if (productId) {
        await updateProduct(productId, parsed.data);
      } else {
        const product = await createProduct(parsed.data, {
          openingStock: hasVariants ? 0 : openingStock,
          openingUnitCost: parsed.data.costPrice,
        });
        productId = product.id;
      }

      // Variants
      for (const draft of variants) {
        if (!draft.label.trim()) continue;
        const variantPayload = {
          productId: productId as string,
          sku: draft.sku,
          label: draft.label,
          size: draft.size,
          color: draft.color,
          weight: draft.weight,
          custom: draft.custom,
          costPrice: draft.costPrice,
          sellingPrice: draft.sellingPrice,
          isActive: true,
        };
        const variantParsed = variantInputSchema.safeParse(variantPayload);
        if (!variantParsed.success) {
          setErrors({ variants: `ভ্যারিয়েন্ট "${draft.label}": ${Object.values(zodErrorMap(variantParsed.error))[0]}` });
          continue;
        }
        const created = await createVariant(variantParsed.data);
        if (draft.openingStock > 0) {
          await adjustStock({
            productId: productId as string,
            variantId: created.id,
            quantity: draft.openingStock,
            type: 'opening',
            referenceType: 'opening',
            unitCost: draft.costPrice,
            reason: 'ওপেনিং স্টক (ভ্যারিয়েন্ট)',
          });
        }
      }

      for (const variant of existingVariants) {
        const draft = variants.find((v) => v.persistedId === variant.id);
        if (!draft) continue;
        await updateVariant(variant.id, {
          sku: draft.sku,
          label: draft.label,
          size: draft.size,
          color: draft.color,
          weight: draft.weight,
          custom: draft.custom,
          costPrice: draft.costPrice,
          sellingPrice: draft.sellingPrice,
        });
      }

      await refresh();
      navigate(`/products/${productId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title={id ? 'পণ্য সম্পাদনা' : 'নতুন পণ্য'} subtitle="দর ও ক্রয়মূল্য আলাদা করে রাখুন — লাভের হিসাব এর ওপর নির্ভর করে" back />

      {error && <ErrorBanner message={error} />}
      {errors.variants && <ErrorBanner message={errors.variants} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="সাধারণ তথ্য" />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Field label="পণ্যের নাম" required error={errors.name} className="sm:col-span-2">
                {({ id: fieldId, invalid }) => (
                  <Input id={fieldId} value={name} invalid={invalid} onChange={(e) => setName(e.target.value)} placeholder="যেমন: কটন টি-শার্ট" />
                )}
              </Field>
              <Field label="SKU" error={errors.sku} hint="না দিলেও চলবে">
                {({ id: fieldId, invalid }) => (
                  <Input
                    id={fieldId}
                    value={sku}
                    invalid={invalid}
                    dir="ltr"
                    onChange={(e) => {
                      setSku(e.target.value);
                      setSkuWarning(null);
                    }}
                    onBlur={async () => {
                      if (sku.trim() && (await isSkuTaken(sku, id))) setSkuWarning('এই SKU আগেই ব্যবহৃত হয়েছে');
                    }}
                  />
                )}
              </Field>
              <Field label="বারকোড" error={errors.barcode}>
                {({ id: fieldId }) => <Input id={fieldId} value={barcode} onChange={(e) => setBarcode(e.target.value)} dir="ltr" />}
              </Field>
              {skuWarning && (
                <p className="text-xs font-medium text-amber-700 sm:col-span-2">
                  <Icon name="warning" size={13} className="mr-1 inline" />
                  {skuWarning}
                </p>
              )}
              <Field label="ক্যাটেগরি">
                {({ id: fieldId }) => (
                  <Select id={fieldId} options={categories.options} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} placeholder="নির্বাচন করুন" />
                )}
              </Field>
              <Field label="ব্র্যান্ড">
                {({ id: fieldId }) => <Input id={fieldId} value={brand} onChange={(e) => setBrand(e.target.value)} />}
              </Field>
              <Field label="একক">
                {({ id: fieldId }) => (
                  <Select id={fieldId} options={DEFAULT_UNITS.map((u) => ({ value: u, label: u }))} value={unit} onChange={(e) => setUnit(e.target.value)} />
                )}
              </Field>
              <Field label="সতর্ক সীমা" hint="এর নিচে গেলে “কম স্টক” দেখাবে">
                {({ id: fieldId }) => (
                  <Input id={fieldId} type="number" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Number(e.target.value) || 0)} />
                )}
              </Field>
              <Field label="বিবরণ" className="sm:col-span-2">
                {({ id: fieldId }) => (
                  <Textarea id={fieldId} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="বাংলা বা ইংরেজিতে যেকোনো ভাষায় লিখতে পারেন" />
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="মূল্য" subtitle="সব হিসাব পয়সায় (পূর্ণসংখ্যা) করা হয়, তাই ভগ্নাংশে ভুল হয় না" />
            <CardBody className="grid gap-3 sm:grid-cols-3">
              <Field label="ক্রয়মূল্য" required error={errors.costPrice} hint="সাপ্লায়ার থেকে কেনা দাম">
                {({ id: fieldId }) => <MoneyInput id={fieldId} value={costPrice} onChange={setCostPrice} />}
              </Field>
              <Field label="বিক্রয়মূল্য" required error={errors.sellingPrice}>
                {({ id: fieldId }) => <MoneyInput id={fieldId} value={sellingPrice} onChange={setSellingPrice} />}
              </Field>
              <Field label="ছাড় মূল্য" hint="খালি রাখলে বিক্রয়মূল্যই থাকবে">
                {({ id: fieldId }) => <MoneyInput id={fieldId} value={discountPrice} onChange={setDiscountPrice} />}
              </Field>
              {sellingPrice > 0 && costPrice > 0 && (
                <p className="text-xs text-ink-500 sm:col-span-3">
                  প্রতি ইউনিটে আনুমানিক লাভ: <strong className="text-brand-700">{formatProfit(sellingPrice - costPrice)}</strong>
                  {discountPrice > 0 && <> (ছাড় মূল্যে: {formatProfit(discountPrice - costPrice)})</>}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="ভ্যারিয়েন্ট"
              subtitle="সাইজ, রঙ, ওজন — প্রতিটির আলাদা দর ও স্টক রাখতে পারবেন"
              action={
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox label="ভ্যারিয়েন্ট আছে" checked={hasVariants} onChange={(e) => setHasVariants(e.target.checked)} />
                </label>
              }
            />
            <CardBody className="px-0 py-0">
              {!hasVariants ? (
                <div className="px-4 py-4">
                  {!id && (
                    <Field label="ওপেনিং স্টক" hint="এখন কত পিস আছে — পরে স্টক পেজ থেকে বাড়াতে পারবেন">
                      {({ id: fieldId }) => (
                        <Input id={fieldId} type="number" min={0} value={openingStock} onChange={(e) => setOpeningStock(Number(e.target.value) || 0)} />
                      )}
                    </Field>
                  )}
                  <p className="mt-2 text-xs text-ink-500">ভ্যারিয়েন্ট না থাকলে পণ্যের নিজস্ব দর ও স্টক ব্যবহার হবে।</p>
                </div>
              ) : (
                <div className="space-y-3 p-4">
                  {existingVariants.map((variant) => {
                    const draft = variants.find((v) => v.persistedId === variant.id) ?? {
                      ...emptyVariant(),
                      persistedId: variant.id,
                      label: variant.label,
                      sku: variant.sku,
                      size: variant.attributes.size,
                      color: variant.attributes.color,
                      weight: variant.attributes.weight,
                      custom: variant.attributes.custom,
                      costPrice: variant.costPrice,
                      sellingPrice: variant.sellingPrice,
                    };
                    return (
                      <VariantRow
                        key={variant.id}
                        draft={draft}
                        onChange={(next) => {
                          setVariants((prev) => {
                            const found = prev.find((v) => v.persistedId === variant.id);
                            if (found) return prev.map((v) => (v.persistedId === variant.id ? next : v));
                            return [...prev, next];
                          });
                        }}
                        onRemove={async () => {
                          await deleteVariant(variant.id);
                          setExistingVariants((prev) => prev.filter((v) => v.id !== variant.id));
                          await refresh();
                        }}
                        persisted
                      />
                    );
                  })}
                  {variants
                    .filter((v) => !v.persistedId)
                    .map((draft) => (
                      <VariantRow
                        key={draft.id}
                        draft={draft}
                        onChange={(next) => setVariants((prev) => prev.map((v) => (v.id === draft.id ? next : v)))}
                        onRemove={() => setVariants((prev) => prev.filter((v) => v.id !== draft.id))}
                      />
                    ))}
                  <Button
                    variant="outline"
                    icon="plus"
                    size="sm"
                    onClick={() =>
                      setVariants((prev) => [...prev, { ...emptyVariant(), costPrice, sellingPrice }])
                    }
                  >
                    ভ্যারিয়েন্ট যোগ
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="পণ্যের ছবি" subtitle="ঐচ্ছিক — ডিভাইসেই সংরক্ষিত হয়" />
            <CardBody className="space-y-3">
              {imageDataUrl ? (
                <img src={imageDataUrl} alt={name || 'পণ্যের ছবি'} className="mx-auto h-36 w-36 rounded-lg border border-ink-200 object-contain" />
              ) : (
                <div className="mx-auto flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-ink-300 text-ink-300">
                  <Icon name="products" size={32} />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                aria-label="পণ্যের ছবি নির্বাচন"
                className="block w-full text-sm"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    setImageDataUrl(await resizeImageFile(file, 320));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'ছবি প্রক্রিয়া করা যায়নি');
                  }
                }}
              />
              {imageDataUrl && (
                <Button variant="ghost" size="sm" icon="trash" onClick={() => setImageDataUrl(null)}>
                  ছবি সরিয়ে দিন
                </Button>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="স্ট্যাটাস" />
            <CardBody>
              <Checkbox label="পণ্য চালু আছে (নতুন অর্ডারে দেখাবে)" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            </CardBody>
          </Card>

          {hasVariants && (
            <WarningBanner>
              ভ্যারিয়েন্ট চালু করলে পণ্যের নিজস্ব দর ও স্টক বদলে প্রতিটি ভ্যারিয়েন্টের দর ও স্টক ব্যবহার হবে।
            </WarningBanner>
          )}

          <div className="sticky bottom-16 space-y-2 rounded-xl border border-ink-200 bg-white p-3 shadow-pop lg:bottom-4">
            <Button block onClick={submit} loading={saving} icon="save">
              {id ? 'হালনাগাদ সংরক্ষণ' : 'পণ্য সংরক্ষণ'}
            </Button>
            <Button block variant="outline" onClick={() => navigate(-1)}>
              বাতিল
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function VariantRow({
  draft,
  onChange,
  onRemove,
  persisted = false,
}: {
  draft: VariantDraft;
  onChange: (next: VariantDraft) => void;
  onRemove: () => void | Promise<void>;
  persisted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-ink-200 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="নাম/লেবেল" required>
          {({ id }) => <Input id={id} value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} placeholder="যেমন: লাল / L" />}
        </Field>
        <Field label="SKU">
          {({ id }) => <Input id={id} value={draft.sku} dir="ltr" onChange={(e) => onChange({ ...draft, sku: e.target.value })} />}
        </Field>
        <Field label="সাইজ">
          {({ id }) => <Input id={id} value={draft.size} onChange={(e) => onChange({ ...draft, size: e.target.value })} />}
        </Field>
        <Field label="রঙ">
          {({ id }) => <Input id={id} value={draft.color} onChange={(e) => onChange({ ...draft, color: e.target.value })} />}
        </Field>
        <Field label="ওজন">
          {({ id }) => <Input id={id} value={draft.weight} onChange={(e) => onChange({ ...draft, weight: e.target.value })} />}
        </Field>
        <Field label="অন্যান্য">
          {({ id }) => <Input id={id} value={draft.custom} onChange={(e) => onChange({ ...draft, custom: e.target.value })} />}
        </Field>
        <Field label="ক্রয়মূল্য">
          {({ id }) => <MoneyInput id={id} value={draft.costPrice} onChange={(value) => onChange({ ...draft, costPrice: value })} />}
        </Field>
        <Field label="বিক্রয়মূল্য">
          {({ id }) => <MoneyInput id={id} value={draft.sellingPrice} onChange={(value) => onChange({ ...draft, sellingPrice: value })} />}
        </Field>
        {!persisted && (
          <Field label="ওপেনিং স্টক">
            {({ id }) => (
              <Input id={id} type="number" min={0} value={draft.openingStock} onChange={(e) => onChange({ ...draft, openingStock: Number(e.target.value) || 0 })} />
            )}
          </Field>
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" icon="trash" onClick={() => void onRemove()}>
          সরিয়ে দিন
        </Button>
      </div>
    </div>
  );
}

function formatProfit(minor: number): string {
  return `৳${(minor / 100).toFixed(2)}`;
}
