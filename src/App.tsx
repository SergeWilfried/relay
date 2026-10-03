import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { ThemeProvider } from './state/theme';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import Login from './routes/Login';
const Admin = lazy(() => import('./routes/admin/Admin')); // separate chunk: ordinary users never download it
import { TradeLayout } from './routes/trade/TradeLayout';
import { PoolLayout } from './routes/pool/PoolLayout';
import TradeForm from './routes/trade/TradeForm';
import Review from './routes/trade/Review';
import Verify from './routes/trade/Verify';
import VerifySdk from './routes/trade/VerifySdk';
import Deposit from './routes/trade/Deposit';
import Pay from './routes/trade/Pay';
import Status from './routes/trade/Status';
import PoolList from './routes/pool/PoolList';
import PoolDetail from './routes/pool/PoolDetail';
import PoolRisk from './routes/pool/PoolRisk';
import PoolAdd from './routes/pool/PoolAdd';
import PoolKyc from './routes/pool/PoolKyc';
import PoolVerify from './routes/pool/PoolVerify';
import PoolDone from './routes/pool/PoolDone';
import PoolWithdraw from './routes/pool/PoolWithdraw';
import PoolWithdrawn from './routes/pool/PoolWithdrawn';
import PoolEarnings from './routes/pool/PoolEarnings';
import PoolHistory from './routes/pool/PoolHistory';
import Activity from './routes/Activity';
import Account from './routes/Account';
import KycTab from './routes/KycTab';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="login" element={<Login />} />
            {/* internal back office: its own login (the admin key), not linked from the app */}
            <Route path="admin" element={<Suspense fallback={null}><Admin /></Suspense>} />
            <Route element={<RequireAuth />}>
            {/* the identity check opens here in its own tab, outside the app shell */}
            <Route path="kyc/verify" element={<KycTab />} />
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/trade/swap" replace />} />
              <Route path="trade" element={<TradeLayout />}>
                <Route index element={<Navigate to="swap" replace />} />
                <Route path="review" element={<Review />} />
                <Route path="verify" element={<Verify />} />
                <Route path="verify/sdk" element={<VerifySdk />} />
                <Route path="deposit/:id" element={<Deposit />} />
                <Route path="pay/:id" element={<Pay />} />
                <Route path="status/:id" element={<Status />} />
                <Route path=":tab" element={<TradeForm />} />
              </Route>
              <Route path="pool" element={<PoolLayout />}>
                <Route index element={<PoolList />} />
                <Route path="risk" element={<PoolRisk />} />
                <Route path="add" element={<PoolAdd />} />
                <Route path="kyc" element={<PoolKyc />} />
                <Route path="verify" element={<PoolVerify />} />
                <Route path="done" element={<PoolDone />} />
                <Route path="withdraw" element={<PoolWithdraw />} />
                <Route path="withdrawn" element={<PoolWithdrawn />} />
                <Route path="earnings" element={<PoolEarnings />} />
                <Route path="activity" element={<PoolHistory />} />
                <Route path=":id" element={<PoolDetail />} />
              </Route>
              <Route path="activity" element={<Activity />} />
              <Route path="account" element={<Account />} />
              <Route path="*" element={<Navigate to="/trade/swap" replace />} />
            </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
