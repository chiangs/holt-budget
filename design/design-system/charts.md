# Charts

Charts in Holt answer one question each, quickly and exactly.

## Rules
1. **No rings, pies or donuts.** Lengths on a common baseline are read more accurately than angles or areas.
2. **One question per chart**, written as its title where it fits ("How long could we last?").
3. **Label values directly.** Avoid legends; if one is unavoidable, keep it to three items.
4. **Figures in Plex Mono:** figure-xl for headline values, table for labels and tables, data-caption for scale labels.
5. **Colour by role, never by series count:**
   - chart-1 (accent) is the thing the chart is about
   - chart-2 and chart-3 are lighter tints for parts and context
   - attention marks only what needs action
   - chart-ref (text colour) is for the family's reference lines
   - chart-grid is for ticks
6. **Never colour alone.** Segments carry labels and positions; states carry words.
7. **Every chart shows its working** on selection: the filter as chips, and the transactions.
8. **Animate only change:** a bar grows to its new value (200ms). Nothing loops or idles.

## Which chart for which question
| Question | Chart | Notes |
|---|---|---|
| How does one value compare with a target or limit? | **Tick scale** | A ticked track (chart-track, chart-grid ticks), a value bar (chart-1, scale-height), and reference marks (chart-ref) for the family's settings, each labelled. Used for vital signs, buffer progress, and a job against its plan. |
| What is the whole made of? | **Proportional bar** + table | One bar (proportion-height), segments in chart-1 → chart-3, 2px gaps, radius-xs. A table beneath gives exact figures. Unassigned shows in attention when non-zero. |
| Where does money flow from and to? | **Money Map** | Blocks in three columns (money in → shared accounts → groups), heights to scale, each block selectable. |
| How has it changed over time? | **Line**; **sparkline** in tight spaces; **columns** for monthly amounts | Lines for balances (buffer, net worth). Columns for monthly flows (spending on a job). Comparison periods in chart-2. |
| Which is biggest, or furthest from plan? | **Sorted horizontal bars**; **diverging bars** around zero for over/under | Insurance by type; the review's "furthest from plan". Bars over plan are labelled "over", not coloured red. |
| How did the month get from money in to money left? | **Waterfall** | Monthly review: money in, each group out, saving, unassigned. |
| What's coming, and is it covered? | **12-month ribbon** | One cell per month. Funded items in accent-soft, short in attention-soft, the current month marked. |
| How are individual amounts spread out? | **Dot strip** or simple histogram | For example weekend food shops, in Ask or find. |
