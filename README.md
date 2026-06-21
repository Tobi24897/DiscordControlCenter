# Discord Control Center

**All your trading Discords, X feeds, and news in ONE window — a clean column dashboard (like TweetDeck / X Pro).**

Instead of jumping between 10 Discord channels and several browser tabs, everything sits side by side in one calm, dark dashboard: Discord channels, X/Twitter profiles, and news headlines (WSJ, FT, CNBC, Bloomberg …) — each source as its own column.

Runs locally on your Windows PC. **No installation, no coding, free.**

![Discord Control Center — settings with all sources](docs/settings.png)

---

## ⬇️ Download & Run (for everyone — no tech skills needed)

> **Important:** Do **NOT** use the green "Code → Download ZIP" button at the top. That gives you only the source code *without* the ready-to-run program.

**The right way — in 2 minutes:**

1. **[➡️ Download the ready-to-run ZIP here](https://github.com/Tobi24897/DiscordControlCenter/releases/latest)** — on the release page, click the file **`DiscordControlCenter.zip`** (under "Assets").
2. **Unzip** it (right-click → "Extract All…"). Put the extracted folder somewhere, e.g. on your Desktop.
3. Double-click **`Start Discord Control Center.vbs`** inside the folder.
4. Your browser opens. In **Settings**, log in to Discord once (one click — see the guide). Done.

👉 **The full, illustrated step-by-step guide is in [GUIDE.md](GUIDE.md).** If anything goes wrong, the fix is there too.

**Close the window = quit.** When you close the browser tab, the tool shuts itself down — like a normal program. No leftovers, nothing "still running in the background".

---

## What can it do?

- **Feed** — all selected Discord channels in one chronological stream, with search.
- **Columns** — one column per source, side by side (X-Pro style), freely arranged, adjustable width.
- **X / Twitter** — any public profile as a column (via free Nitter feeds).
- **News** — headlines from WSJ, FT, CNBC, MarketWatch, Bloomberg & Reuters (via Google News), Yahoo, Nasdaq … or any RSS URL.
- **DMs** — read, write, and reply to Discord direct messages, friends list, send screenshots by paste (Ctrl+V).
- **Notifications** — desktop alert + sound per channel, optionally only on keywords (`$` = any cashtag).
- **Cashtags** like `$AAPL` link straight to TradingView.

Everything **free** — no paid APIs, no subscriptions, no cloud. Your data stays on your PC.

---

## FAQ

**Do I have to install anything?** No. Python is already bundled in the folder (portable). Just unzip and start.

**Does it cost anything?** No. Completely free.

**Where is my data?** Only locally on your PC (`data\` in the folder). Your Discord login is stored only locally (`.env`) and sent only to Discord itself — nowhere else, nothing is uploaded.

**Is this official from Discord?** No. The tool accesses the Discord API with your personal Discord login (user token, the same principle as DiscordChatExporter). Automating a normal user account **violates Discord's Terms of Service** — use at your own risk, no warranty. The tool reads slowly and gently on purpose; messages are sent **only** manually by you, never automatically. Follow your servers' rules.

**Windows warns on start ("Windows protected your PC")?** Normal for small, unsigned tools. "More info" → "Run anyway". Details in [GUIDE.md](GUIDE.md).

---

## For the technically curious

Local web app: **FastAPI + SQLite + SSE** (backend, Python) and **React + Tailwind** (frontend, pre-built in `frontend/dist/`). The backend polls the Discord REST API incrementally, plus Nitter RSS and generic RSS feeds as additional column sources. Port **8020**, all local.

Build/run from source: see **[GUIDE.md → "Run from source"](GUIDE.md#run-from-source-for-developers)**.

---

## License / Liability

Private hobby project, no warranty, free to use among friends. No liability for account bans, data loss, or any other damage. You are responsible for how you use your own Discord account.
