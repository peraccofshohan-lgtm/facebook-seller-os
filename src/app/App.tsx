import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useAppContext } from './AppContext';
import { AppShell } from './AppShell';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastProvider } from '@/components/ui/Feedback';
import { bootstrapApp } from './bootstrap';

import DashboardPage from '@/features/dashboard/DashboardPage';
import SetupPage from '@/features/settings/SetupPage';
import OrdersPage from '@/features/orders/OrdersPage';
import OrderFormPage from '@/features/orders/OrderFormPage';
import OrderDetailsPage from '@/features/orders/OrderDetailsPage';
import CustomersPage from '@/features/customers/CustomersPage';
import CustomerFormPage from '@/features/customers/CustomerFormPage';
import CustomerDetailsPage from '@/features/customers/CustomerDetailsPage';
import ProductsPage from '@/features/products/ProductsPage';
import ProductFormPage from '@/features/products/ProductFormPage';
import ProductDetailsPage from '@/features/products/ProductDetailsPage';
import InventoryPage from '@/features/inventory/InventoryPage';
import CourierPage from '@/features/courier/CourierPage';
import PaymentsPage from '@/features/payments/PaymentsPage';
import ReturnsPage from '@/features/returns/ReturnsPage';
import ExpensesPage from '@/features/expenses/ExpensesPage';
import ReportsPage from '@/features/reports/ReportsPage';
import BackupPage from '@/features/backup/BackupPage';
import SettingsPage from '@/features/settings/SettingsPage';
import HelpPage from '@/features/help/HelpPage';
import NotFoundPage from '@/features/help/NotFoundPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    bootstrapApp()
      .then(() => setReady(true))
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
        <div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-rose-700">ডেটাবেস খোলা যায়নি</h1>
          <p className="mt-2 text-sm text-ink-600">{error.message}</p>
          <p className="mt-3 text-xs text-ink-500">
            সাধারণত ব্রাউজারের প্রাইভেট/গোপন মোড বা স্টোরেজ ব্লক করা থাকলে এই সমস্যা হয়। সাধারণ ট্যাবে আবার খুলে দেখুন।
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-700 border-t-transparent" />
          <p className="text-sm text-ink-500">অ্যাপ লোড হচ্ছে…</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route element={<GuardedShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/orders/new" element={<OrderFormPage />} />
                <Route path="/orders/:id" element={<OrderDetailsPage />} />
                <Route path="/orders/:id/edit" element={<OrderFormPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/new" element={<CustomerFormPage />} />
                <Route path="/customers/:id" element={<CustomerDetailsPage />} />
                <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/products/new" element={<ProductFormPage />} />
                <Route path="/products/:id" element={<ProductDetailsPage />} />
                <Route path="/products/:id/edit" element={<ProductFormPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/courier" element={<CourierPage />} />
                <Route path="/payments" element={<PaymentsPage />} />
                <Route path="/returns" element={<ReturnsPage />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/backup" element={<BackupPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AppProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

/** First-run: send the user to the business profile setup before anything else. */
function GuardedShell() {
  const { settings } = useAppContext();
  if (settings && !settings.onboardingCompleted) return <Navigate to="/setup" replace />;
  return <AppShell />;
}
