import { Route, Routes } from "react-router-dom";

import { GeneratorPage } from "./pages/GeneratorPage";
import { DriverPage } from "./pages/DriverPage";
import { LandingPage } from "./pages/LandingPage";
import { PlantPage } from "./pages/PlantPage";
import { ROUTES } from "./routes";
import { RoleAccessPage } from "./pages/RoleAccessPage";
import { Link } from "react-router-dom";

export function App() {
  return (
    <Routes>
      <Route path={ROUTES.landing} element={<LandingPage />} />
      <Route path={ROUTES.generator} element={<GeneratorPage />} />
      <Route path={ROUTES.plant} element={<PlantPage />} />
      <Route path={ROUTES.driver} element={<DriverPage />} />
      <Route path="/kitchen-access" element={<RoleAccessPage role="kitchen" />} />
      <Route path="/driver-access" element={<RoleAccessPage role="driver" />} />
      <Route path="*" element={<main className="auth-shell"><section className="token-panel"><h1>This page could not be found</h1><p>Open your dispatcher-issued private link, or choose your role from the home page.</p><Link className="button button-primary" to="/">Choose my role</Link></section></main>} />
    </Routes>
  );
}
