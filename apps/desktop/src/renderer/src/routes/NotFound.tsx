import { useIntl } from "react-intl";
import { Link } from "react-router";

export function NotFound() {
  const intl = useIntl();
  return (
    <>
      <h1 className="type-title-screen">{intl.formatMessage({ id: "screen.notFound.title" })}</h1>
      <p>
        <Link to="/">{intl.formatMessage({ id: "screen.notFound.action" })}</Link>
      </p>
    </>
  );
}
