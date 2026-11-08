# Button

Buttons start an action; links go somewhere.

- **Primary** (accent fill, accent-ink text): one per panel, for the action the panel exists for ("Add job", "Approve").
- **Secondary** (line border, text colour): the alternatives ("Cancel", "Change").
- **Quiet** (accent text, no border): low-stakes, inline actions ("Undo", "Show the transactions").
- **Destructive** (danger border and text): actions that remove or reverse data. Always followed by a confirm step on danger-soft.
- **Size and shape:** at least target-min tall, radius-md; pill (radius-full) only for status pills, not buttons.
- **Labels:** a verb plus an object in sentence case, active voice. No "OK" or "Submit". Shortcut letters appear in the tooltip.
- **Focus:** a 2px focus ring with a 2px offset, never removed.
