import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton, EmptyState } from '@/components/ui/Feedback';
import { LinkButton } from '@/components/ui/Button';
import { useAsync } from '@/hooks/useAsync';
import { getOrder } from '@/services/orderService';
import { OrderForm } from './OrderForm';

export default function OrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const state = useAsync(() => (id ? getOrder(id) : Promise.resolve(undefined)), [id]);

  if (id && state.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (id && !state.data) {
    return (
      <EmptyState
        icon="orders"
        title="অর্ডার পাওয়া যায়নি"
        description="এই অর্ডারটি মুছে ফেলা হয়েছে অথবা লিঙ্কটি সঠিক নয়।"
        action={<LinkButton to="/orders">অর্ডার তালিকায় যান</LinkButton>}
      />
    );
  }

  return (
    <>
      <PageHeader title={id ? 'অর্ডার সম্পাদনা' : 'নতুন অর্ডার'} subtitle={id ? state.data?.orderNumber : 'ফেসবুক, মেসেঞ্জার, ফোন — যেকোনো চ্যানেলের অর্ডার'} back />
      <OrderForm mode={id ? 'edit' : 'create'} initial={state.data ?? undefined} onSaved={() => navigate('/orders')} />
    </>
  );
}

export function OrderFormCardFallback() {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-ink-500">লোড হচ্ছে…</p>
      </CardBody>
    </Card>
  );
}
