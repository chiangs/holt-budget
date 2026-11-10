import type { ReactElement } from "react";
import { createHashRouter, type RouteObject } from "react-router";
import { Layout } from "./Layout.tsx";
import { NotFound } from "./routes/NotFound.tsx";
import { Screen } from "./routes/Screen.tsx";
import { Settings } from "./routes/Settings.tsx";
import { Transactions } from "./routes/transactions/Transactions.tsx";
import { screens } from "./screens.ts";

const built: Record<string, ReactElement> = { "/settings": <Settings />, "/transactions": <Transactions /> };

const children: RouteObject[] = screens.map((screen) => {
  const element = built[screen.path] ?? <Screen titleId={screen.titleId} questionId={screen.questionId} />;
  return screen.path === "/" ? { index: true, element } : { path: screen.path.slice(1), element };
});

// SPA data mode, no server (technical-decisions.md §2). Loaders will call window.holt.
export const router = createHashRouter([{ path: "/", Component: Layout, children: [...children, { path: "*", element: <NotFound /> }] }]);
