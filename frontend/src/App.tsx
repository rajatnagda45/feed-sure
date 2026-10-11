import { Route, Routes } from "react-router-dom";

import { GeneratorPage } from "./pages/GeneratorPage";
import { DriverPage } from "./pages/DriverPage";
import { LandingPage } from "./pages/LandingPage";
import { PlantPage } from "./pages/PlantPage";
import { ROUTES } from "./routes";

export function App() {
  return (
    <Routes>
      <Route path={ROUTES.landing} element={<LandingPage />} />
      <Route path={ROUTES.generator} element={<GeneratorPage />} />
      <Route path={ROUTES.plant} element={<PlantPage />} />
      <Route path={ROUTES.driver} element={<DriverPage />} />
    </Routes>
  );
}
