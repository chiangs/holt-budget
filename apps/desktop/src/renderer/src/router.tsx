import { createHashRouter } from "react-router";
import { Layout } from "./Layout.tsx";
import { Placeholder } from "./routes/Placeholder.tsx";

// SPA data mode, no server (technical-decisions.md §2). Loaders will call window.holt.
export const router = createHashRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, element: <Placeholder title="Overview" /> },
      { path: "transactions", element: <Placeholder title="Transactions" /> },
      { path: "plan", element: <Placeholder title="Plan" /> },
      { path: "recurring", element: <Placeholder title="Recurring costs" /> },
      { path: "review", element: <Placeholder title="Monthly review" /> },
      { path: "insurance", element: <Placeholder title="Insurance" /> },
      { path: "ask", element: <Placeholder title="Ask or find" /> },
      { path: "settings", element: <Placeholder title="Settings" /> },
    ],
  },
]);
