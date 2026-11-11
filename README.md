# Holt

*Every unit of money a job.*

Holt is a household budget planner for Linux. It helps a household give every unit of money a job: where the shared money comes from, where it goes, and what it's set aside for, from this month's spending to the long-term plan.

- **Private by design.** Holt runs entirely on your computer. Your statements, figures and notes never leave it, and the database is encrypted.
- **Your currency.** One currency for the whole household, any you choose. Holt never mixes or converts currencies.
- **Backups you can restore anywhere.** Holt makes encrypted backups to a folder you choose. If your own sync tool uploads that folder, a recovery code opens them on any computer.
- **A local assistant, not an autopilot.** A language model running on your own machine suggests jobs for transactions, answers questions about your money, and drafts the monthly review. The app does every calculation; the assistant never decides.
- **Built for the Linux desktop.** Arch, CachyOS and Hyprland first, with a theme that can follow your Caelestia colour scheme.

> Status: pre-alpha. The product and design are specified in `docs/` and `design/`; the code is starting with the spikes in `BACKLOG.md`.

## Requirements (planned)
- Linux on Wayland (Hyprland tested first).
- A local model runtime with an OpenAI-compatible API on your machine: llama.cpp's `llama-server`, LM Studio / `llmster`, or Ollama.
- Bank statements as CSV or OFX. The first import profiles are for Bulder and SpareBank 1 SR-Bank.

## Developing
```
pnpm install
pnpm tokens
pnpm test
pnpm dev
```
`./run.sh` builds this copy as it is now, committed or not, and opens it once, without hot reload, on the synthetic household in `~/.local/share/holt-dev`. Use it to see the latest code. The copy that `./install.sh` puts in your launcher is a production build, which has no seed and no Setup yet, so it opens empty. `./run.sh --reseed` starts the synthetic household again, and `./run.sh --no-build` opens the last build.

See `CLAUDE.md` for the rules, layout and conventions, and `docs/` for the decisions behind them.

## Licence
MIT. Third-party assets are listed in `THIRD_PARTY_NOTICES.md`.
