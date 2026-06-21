# 📖 Guide — Discord Control Center

This guide walks you through everything, step by step. You need **no** tech skills and you **don't** have to install anything. If you get stuck, see [Troubleshooting](#-it-doesnt-work-troubleshooting) at the bottom.

**Requirement:** A Windows 10 or Windows 11 PC. That's it.

---

## 1. Download

1. Go to the **[Releases page](https://github.com/Tobi24897/DiscordControlCenter/releases/latest)**.
2. Download the file **`DiscordControlCenter.zip`** there (under "Assets").

> ⚠️ Do **not** use the green "Code → Download ZIP" button on the start page. That only contains the source code, **not** the ready-to-run program with Python. It must be the ZIP from the **Releases** section.

---

## 2. Unzip

1. Find the downloaded `DiscordControlCenter.zip` in your Downloads folder.
2. **Right-click → "Extract All…"** → "Extract".
3. Move the extracted folder somewhere permanent, e.g. your **Desktop**.

> ⚠️ **Important:** Run the tool from the **extracted** folder — **not** from inside the ZIP (don't double-click into the ZIP and start it from there). Otherwise it can't find its files.

---

## 3. Start

Inside the extracted folder there's a file called:

> **`Start Discord Control Center.vbs`**

**Double-click** it. After a few seconds your browser opens automatically with the dashboard.

### "Windows protected your PC" — what to do?

On the very first start, Windows may show a blue "Windows protected your PC" window (SmartScreen). This is normal for small programs that aren't expensively signed, and is **not a virus**.

→ Click **"More info"**, then **"Run anyway"**.

If your antivirus complains: the tool starts a small script (`.vbs`) — not a virus, the full source code is open to inspect. In **Windows Defender** you can add the extracted folder as an exclusion: search box → **"Windows Security"** → "Virus & threat protection" → "Manage settings" → at the bottom "Add or remove exclusions" → "Folder" → choose the extracted folder.

### Prefer an icon on your desktop?

Double-click **`Create Desktop Shortcut.vbs`** in the folder. A **"Discord Control Center"** icon then appears on your desktop, which you can use to start the tool from now on.

---

## 4. One time: log in to Discord

So the tool can read your Discord channels, it has to connect to your Discord once. **You don't have to do anything complicated** — one bookmark click is enough.

> Background: the tool signs in with your normal Discord login (your "token"). You don't type any password into the tool. The bookmark grabs the login directly from your already-logged-in Discord in the browser.

**How to do it (easiest way — the "🔑 Discord Login" button):**

1. In the tool, click **Settings** at the top. There's a button **"🔑 Discord Login"**.
2. **First, show the bookmarks bar.** That's the thin bar right **below the address bar** where saved websites live. Don't see it? Press **`Ctrl + Shift + B`** — then it appears.
3. **Drag** the **"🔑 Discord Login"** button into that bar with the mouse held down, and drop it there. It now sits as a small bookmark at the top.
4. Open a new tab, go to **[discord.com](https://discord.com)**, and log in there as usual (if you're not already).
5. Now — while Discord is open — click your new **"🔑 Discord Login"** in the bookmarks bar.
6. The tool reopens automatically and a green note **"Logged in as … ✓"** appears at the top. **Done — you're logged in.**

**Only as a last resort (if the bookmark really won't work):**

> ⚠️ This way is much more technical. If you're unsure, better ask whoever gave you the tool — the bookmark way above is almost always easier.

Settings also has a field to **paste a token**. You get the token like this:
1. Open Discord in the browser, press `F12` (developer tools).
2. Open the **"Network"** tab, click any line with `discord.com`.
3. On the right, under **"Request Headers"**, find the line **`authorization`** and copy its long value.
4. Paste it into the token field in the tool → **Save**. Done.

Your login is stored only **locally** in the `.env` file and sent only to Discord itself — nowhere else.

---

## 5. Pick channels & sources

1. In **Settings**, click **"Refresh servers & channels"** — this loads your Discord servers and channels.
2. **Tick** the channels you want to follow.
3. Switch to **Feed** (everything in one stream) or **Columns** (each source as its own column) at the top.

### X / Twitter as a column

Settings → **"Nitter / X profiles"** → add your Twitter/X username (e.g. `DeItaone`, **without** the @ sign). It appears as a column like a Discord channel. (Runs via free Nitter feeds; if a column stays empty, switch the Nitter instance in Settings.)

### News as a column

Settings → **"News feeds"** → pick a preset (WSJ, FT, CNBC, MarketWatch, Bloomberg & Reuters via Google News, Yahoo, Nasdaq …) or paste any RSS URL. Each headline links to the article.

### DMs (direct messages)

**DMs** tab: read conversations and groups, **write and reply**, friends list. You can paste a screenshot straight in with **Ctrl + V**, or attach files via the paperclip / drag-and-drop.

---

## 6. Using it — the most important moves

- **Arrange columns:** drag a column header with the mouse (or use the arrows). Saved automatically.
- **Column width:** the **S / M / L / XL** button per column.
- **"Clear" a column:** the checkmark on a column shows only new messages from then on.
- **History depth:** Settings → **"History window"** sets how far back it loads and how long it keeps messages (default: 1 week).
- **Notifications:** on/off per channel, optionally keyword-only. The first time, the browser asks permission for desktop alerts — "Allow".
- **`$TICKER`** click → opens the TradingView chart.

---

## 7. Quitting

Just **close the browser tab**. The tool shuts itself down completely after a few seconds — no background process is left. The next double-click starts everything fresh.

---

## 🛟 It doesn't work? (Troubleshooting)

**Nothing happens after double-clicking / no browser opens.**
- Wait 10–15 seconds — the first start takes a moment.
- Open your browser yourself and type into the address bar: `http://localhost:8020`
- Did SmartScreen/antivirus block it? See step 3.

**The browser shows "This site can't be reached" / a blank page.**
- The backend wasn't ready yet. **Reload** the page (`F5`) or double-click **`Start Discord Control Center.vbs`** again.

**"Port 8020 in use" / it starts twice.**
- Every start automatically stops the old instance first. If it's stuck: restart the PC once and try again.

**X/Twitter columns stay empty.**
- The free Nitter servers are sometimes reachable, sometimes not. In Settings under "Nitter / X profiles", enter a different instance.

**"Token invalid" / red indicator at the top.**
- Your Discord login expired. Just do step 4 (the bookmark click) again.

**Discord images/charts don't load.**
- Discord image links expire after a while; new messages load fine again.

---

## Run from source (for developers)

If you have Python (3.12+) and Node installed yourself, you don't need the bundled `python\`:

```
pip install -r requirements.txt
# The frontend is already built in frontend/dist/; to rebuild:
#   cd frontend && npm install && npm run build
python backend/main.py
```

Default port is `8020` (change via `SERVER_PORT` in `.env`; copy `.env.example` as a template). The database lives in `data/crawler.db` (SQLite).

---

## ⚖️ Important note

The tool uses your personal Discord login (user token) to read the Discord API — the same principle as the well-known DiscordChatExporter. **Automating a normal user account violates Discord's Terms of Service.** Use at your **own risk**, no warranty. The tool reads slowly and gently on purpose, and messages are sent **only manually by you**, never automatically or in bulk. Be sensible and follow your servers' rules.
