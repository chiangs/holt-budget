# ProportionBar

Shows what a whole is made of: one bar, plus a table with the exact figures. It replaces every pie or donut.

- **Segments:** in order of size, using chart-1, chart-2 and chart-3 (lighter tints of accent, so they differ in lightness). 2px gaps between them, radius-xs corners.
- **The table** carries the meaning: name, amount (table style) and share, each row keyed by a small swatch. The bar alone is never the only way to read a figure.
- **Unassigned** appears in attention only when it is not zero; a tiny slice gets a minimum visible width.
- **More than four segments:** show the top three and group the rest as "Other", which expands in the table.
