import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "react-intl";
import { RouterProvider } from "react-router/dom";
import { AppearanceProvider } from "./appearance.tsx";
import { LedgerProvider } from "./data/ledger.tsx";
import { locale, messages } from "./i18n/messages.ts";
import { router } from "./router.tsx";
// Fonts are bundled from npm (SIL OFL 1.1), never loaded from the internet.
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@holt/ui/tokens.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

createRoot(root).render(
  <StrictMode>
    <IntlProvider locale={locale} messages={messages}>
      <AppearanceProvider>
        <LedgerProvider><RouterProvider router={router} /></LedgerProvider>
      </AppearanceProvider>
    </IntlProvider>
  </StrictMode>,
);
