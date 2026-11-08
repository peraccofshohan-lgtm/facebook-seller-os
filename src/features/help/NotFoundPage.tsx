import { EmptyState } from '@/components/ui/Feedback';
import { LinkButton } from '@/components/ui/Button';

export default function NotFoundPage() {
  return (
    <div className="py-10">
      <EmptyState
        icon="warning"
        title="পেজটি পাওয়া যায়নি"
        description="আপনি যে ঠিকানাটি খুলতে চেয়েছেন সেটি এই অ্যাপে নেই। নিচের বাটনে ড্যাশবোর্ডে ফিরে যান।"
        action={<LinkButton to="/" icon="dashboard">ড্যাশবোর্ডে যান</LinkButton>}
      />
    </div>
  );
}
