import { AccountGate, AuthProvider } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { RegistrationPage } from "./pages/RegistrationPage";
import { AccountsPage, MyAccountPage } from "./pages/AccountsPage";
import { supabaseEnabled } from "./supabase";
import { Navigate, Route, Routes } from "react-router-dom";

import { GeneratorPage } from "./pages/GeneratorPage";
import { DriverPage } from "./pages/DriverPage";
import { LandingPage } from "./pages/LandingPage";
import { PlantPage } from "./pages/PlantPage";
import { PlantOwnerPage } from "./pages/PlantOwnerPage";
import { ROUTES } from "./routes";
import { RoleAccessPage } from "./pages/RoleAccessPage";
import { Link } from "react-router-dom";

export function App() {
  return (
    <AuthProvider><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route path="/account" element={<MyAccountPage />} />
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
    </Routes></AuthProvider>
  );
}
