import {
  ArrowLeftRight,
  CalendarCheck,
  LayoutDashboard,
  ListChecks,
  Repeat,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { MessageId } from "./i18n/messages.ts";

export interface Screen {
  path: string;
  /** The navigation letter. Reserved on every screen (information-architecture-and-glossary.md, Keyboard). */
  key?: string;
  navId?: MessageId;
  titleId: MessageId;
  questionId?: MessageId;
  Icon?: LucideIcon;
  placement?: "top" | "bottom";
}

/** Every screen in the screen map. Ask or find is not here: it opens over the current screen. */
export const screens: Screen[] = [
  { path: "/", key: "O", navId: "nav.overview", titleId: "screen.overview.title", questionId: "screen.overview.question", Icon: LayoutDashboard },
  { path: "/transactions", key: "T", navId: "nav.transactions", titleId: "screen.transactions.title", questionId: "screen.transactions.question", Icon: ArrowLeftRight },
  { path: "/plan", key: "P", navId: "nav.plan", titleId: "screen.plan.title", questionId: "screen.plan.question", Icon: ListChecks },
  { path: "/recurring", key: "R", navId: "nav.recurring", titleId: "screen.recurring.title", questionId: "screen.recurring.question", Icon: Repeat },
  { path: "/review", key: "M", navId: "nav.review", titleId: "screen.review.title", questionId: "screen.review.question", Icon: CalendarCheck },
  { path: "/insurance", key: "I", navId: "nav.insurance", titleId: "screen.insurance.title", questionId: "screen.insurance.question", Icon: Shield },
  { path: "/settings", key: "S", navId: "nav.settings", titleId: "screen.settings.title", Icon: Settings, placement: "bottom" },
  { path: "/setup", titleId: "screen.setup.title", questionId: "screen.setup.question" },
];

export const askKey = "A";
