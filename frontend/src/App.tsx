import { lazy, Suspense } from "react";
import { AccountGate, AuthProvider, SessionGate } from "./auth";
import { LoginPage } from "./pages/LoginPage";
const RegistrationPage = lazy(() => import("./pages/RegistrationPage").then((module) => ({ default: module.RegistrationPage })));
const AccountsPage = lazy(() => import("./pages/AccountsPage").then((module) => ({ default: module.AccountsPage })));
const MyAccountPage = lazy(() => import("./pages/AccountsPage").then((module) => ({ default: module.MyAccountPage })));
import { RecoveryPage, DriverWaitingPage } from "./pages/RecoveryPage";
import { supabaseEnabled } from "./supabase";
import { Navigate, Route, Routes } from "react-router-dom";

const GeneratorPage = lazy(() => import("./pages/GeneratorPage").then((module) => ({ default: module.GeneratorPage })));
const DriverPage = lazy(() => import("./pages/DriverPage").then((module) => ({ default: module.DriverPage })));
const LandingPage = lazy(() => import("./pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const PlantPage = lazy(() => import("./pages/PlantPage").then((module) => ({ default: module.PlantPage })));
const PlantOwnerPage = lazy(() => import("./pages/PlantOwnerPage").then((module) => ({ default: module.PlantOwnerPage })));
import { ROUTES } from "./routes";
const RoleAccessPage = lazy(() => import("./pages/RoleAccessPage").then((module) => ({ default: module.RoleAccessPage })));
import { Link } from "react-router-dom";

export function App() {
  return (
    <AuthProvider>{import.meta.env.DEV && <p className="local-demo-notice" role="note">Local test environment. The in-memory demo API resets collection records when restarted; hosted accounts can remain. Use synthetic operational data.</p>}<Suspense fallback={<main className="auth-shell"><p role="status">Opening page…</p></main>}><Routes>
      <Route path="/forgot-password" element={<RecoveryPage />} />
      <Route path="/reset-password" element={<RecoveryPage reset />} />
      <Route path="/driver" element={<AccountGate role="DRIVER"><DriverWaitingPage /></AccountGate>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route path="/account" element={<SessionGate><MyAccountPage /></SessionGate>} />
      <Route path="/accounts" element={<AccountGate role="ADMIN" manage><AccountsPage /></AccountGate>} />
      <Route path="/accounts/new" element={<AccountGate role="ADMIN" manage><RegistrationPage admin /></AccountGate>} />
      <Route path={ROUTES.landing} element={<LandingPage />} />
      <Route path={ROUTES.generator} element={<AccountGate role="GENERATOR"><GeneratorPage /></AccountGate>} />
      <Route path={ROUTES.plant} element={<AccountGate role="ADMIN"><PlantPage /></AccountGate>} />
      <Route path={ROUTES.admin} element={<AccountGate role="ADMIN"><PlantPage /></AccountGate>} />
      <Route path={ROUTES.owner} element={<AccountGate role="PLANT_OWNER"><PlantOwnerPage /></AccountGate>} />
      <Route path={ROUTES.driver} element={<AccountGate role="DRIVER"><DriverPage /></AccountGate>} />
      <Route path="/supplier-access" element={supabaseEnabled ? <Navigate to="/login" replace /> : <RoleAccessPage role="kitchen" />} />
      <Route path="/kitchen-access" element={supabaseEnabled ? <Navigate to="/login" replace /> : <RoleAccessPage role="kitchen" />} />
      <Route path="/driver-access" element={supabaseEnabled ? <Navigate to="/login" replace /> : <RoleAccessPage role="driver" />} />
      <Route path="*" element={<main className="auth-shell"><section className="token-panel"><h1>This page could not be found</h1><p>Open your dispatcher-issued private link, or choose your role from the home page.</p><Link className="button button-primary" to="/">Choose my role</Link></section></main>} />
    </Routes></Suspense></AuthProvider>
  );
}
