import { useIntl } from "react-intl";
import type { MessageId } from "../i18n/messages.ts";

/** A screen that is not built yet: its name and the question it answers (the screen map). */
export function Screen({ titleId, questionId }: { titleId: MessageId; questionId?: MessageId | undefined }) {
  const intl = useIntl();
  return (
    <>
      <h1 className="type-title-screen">{intl.formatMessage({ id: titleId })}</h1>
      {questionId !== undefined && <p className="muted">{intl.formatMessage({ id: questionId })}</p>}
    </>
  );
}
