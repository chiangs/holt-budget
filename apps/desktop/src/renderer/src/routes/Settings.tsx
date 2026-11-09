import { useIntl } from "react-intl";
import { useAppearance, type ThemeChoice } from "../appearance.tsx";
import { Screen } from "./Screen.tsx";

export function Settings() {
  const intl = useIntl();
  const { theme, setTheme, glass, setGlass, glassBlocked } = useAppearance();
  const choices: { value: ThemeChoice; label: string }[] = [
    { value: "system", label: intl.formatMessage({ id: "appearance.system" }) },
    { value: "hearth-light", label: intl.formatMessage({ id: "appearance.light" }) },
    { value: "hearth-dark", label: intl.formatMessage({ id: "appearance.dark" }) },
  ];
  return (
    <>
      <Screen titleId="screen.settings.title" />
      <section className="panel" aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="type-title-section">{intl.formatMessage({ id: "appearance.title" })}</h2>
        <fieldset>
          <legend>{intl.formatMessage({ id: "appearance.colours" })}</legend>
          {choices.map(({ value, label }) => (
            <label key={value} className="choice">
              <input type="radio" name="theme" value={value} checked={theme === value} onChange={() => setTheme(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="choice">
          <input type="checkbox" checked={glass && !glassBlocked} disabled={glassBlocked} onChange={(event) => setGlass(event.target.checked)} />
          {intl.formatMessage({ id: "appearance.glass" })}
        </label>
        <p className="muted help">{intl.formatMessage({ id: glassBlocked ? "appearance.glassBlocked" : "appearance.glassHelp" })}</p>
      </section>
    </>
  );
}
