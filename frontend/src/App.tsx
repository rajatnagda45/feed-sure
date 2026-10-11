import { Route, Routes } from "react-router-dom";

import { GeneratorPage } from "./pages/GeneratorPage";
import { DriverPage } from "./pages/DriverPage";
import { LandingPage } from "./pages/LandingPage";
import { PlantPage } from "./pages/PlantPage";
import { PlantOwnerPage } from "./pages/PlantOwnerPage";
import { LoginPage } from "./pages/LoginPage";
import { RegistrationPage } from "./pages/RegistrationPage";
import { AccountsPage, MyAccountPage, AccountNavigation } from "./pages/AccountsPage";
import { ROUTES } from "./routes";
import { RoleAccessPage } from "./pages/RoleAccessPage";
import { Link } from "react-router-dom";

export function App() {
  return (
    <><AccountNavigation /><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route path="/accounts" element={<AccountsPage />} />
      <Route path="/accounts/new" element={<RegistrationPage admin />} />
      <Route path="/account" element={<MyAccountPage />} />
      <Route path="/admin" element={<PlantPage />} />
      <Route path="/owner" element={<PlantOwnerPage />} />
      <Route path={ROUTES.landing} element={<LandingPage />} />
      <Route path={ROUTES.generator} element={<GeneratorPage />} />
      <Route path={ROUTES.plant} element={<PlantPage />} />
      <Route path={ROUTES.driver} element={<DriverPage />} />
      <Route path="/kitchen-access" element={<RoleAccessPage role="kitchen" />} />
      <Route path="/driver-access" element={<RoleAccessPage role="driver" />} />
      <Route path="*" element={<main className="auth-shell"><section className="token-panel"><h1>This page could not be found</h1><p>Open your dispatcher-issued private link, or choose your role from the home page.</p><Link className="button button-primary" to="/">Choose my role</Link></section></main>} />
    </Routes></>
  );
}
