# Discord Control Center

**Alle deine Trading-Discords, X-Feeds und News in EINEM Fenster — als übersichtliches Spalten-Dashboard (wie TweetDeck / X Pro).**

Statt zwischen 10 Discord-Channels und mehreren Tabs hin- und herzuspringen, läuft alles in einem ruhigen, dunklen Dashboard nebeneinander: Discord-Channels, X/Twitter-Profile und News-Schlagzeilen (WSJ, FT, CNBC, Bloomberg …) — jede Quelle als eigene Spalte.

Läuft lokal auf deinem Windows-PC. **Keine Installation, kein Programmieren, kostenlos.**

![Discord Control Center — Einstellungen mit allen Quellen](docs/settings.png)

---

## ⬇️ Herunterladen & Starten (für alle — auch ohne Technik-Kenntnisse)

> **Wichtig:** Benutze **NICHT** den grünen „Code → Download ZIP"-Knopf oben. Der gibt dir nur den Quellcode *ohne* das fertige Programm.

**So geht's richtig — in 2 Minuten:**

1. **[➡️ Hier die fertige ZIP herunterladen](https://github.com/Tobi24897/DiscordControlCenter/releases/latest)** — auf der Release-Seite die Datei **`DiscordControlCenter.zip`** anklicken.
2. ZIP **entpacken** (Rechtsklick → „Alle extrahieren…"). Den entpackten Ordner irgendwohin legen, z. B. auf den Desktop.
3. Im Ordner **`Discord Control Center starten.vbs`** doppelklicken.
4. Der Browser öffnet sich. Oben in den **Einstellungen** einmal mit Discord einloggen (ein Klick, siehe Anleitung) — fertig.

👉 **Die ausführliche, bebilderte Schritt-für-Schritt-Anleitung steht in [GUIDE.md](GUIDE.md).** Wenn irgendwas hakt: dort steht auch die Problemlösung.

**Fenster zu = Programm aus.** Schließt du den Browser-Tab, fährt sich das Tool von selbst herunter — wie ein normales Programm. Keine Reste, kein „läuft im Hintergrund weiter".

---

## Was kann es?

- **Feed** — alle ausgewählten Discord-Channels chronologisch in einem Strom, mit Suche.
- **Spalten** — eine Spalte pro Quelle nebeneinander (X-Pro-Style), frei anordnen, Breite einstellbar.
- **X / Twitter** — beliebige öffentliche Profile als Spalte (über kostenlose Nitter-Feeds).
- **News** — Schlagzeilen von WSJ, FT, CNBC, MarketWatch, Bloomberg & Reuters (via Google News), Yahoo, Nasdaq … oder jede beliebige RSS-Adresse.
- **DMs** — Discord-Direktnachrichten lesen, schreiben, antworten, Freundesliste, Screenshots per Einfügen (Strg+V) mitschicken.
- **Benachrichtigungen** — Desktop-Hinweis + Ton pro Channel, optional nur bei Stichwörtern (`$` = jeder Cashtag).
- **Cashtags** wie `$AAPL` werden direkt zu TradingView verlinkt.

Alles **kostenlos** — keine bezahlten APIs, keine Abos, keine Cloud. Deine Daten bleiben auf deinem PC.

---

## Häufige Fragen

**Muss ich etwas installieren?** Nein. Python ist bereits im Ordner mit dabei (portable). Einfach entpacken und starten.

**Kostet das was?** Nein. Komplett kostenlos.

**Wo liegen meine Daten?** Nur lokal auf deinem PC (`data\` im Ordner). Dein Discord-Login wird nur lokal gespeichert (`.env`) und ausschließlich an Discord selbst geschickt — nirgendwo sonst hin, nichts wird hochgeladen.

**Ist das offiziell von Discord?** Nein. Das Tool greift mit deinem persönlichen Discord-Login (User-Token, dasselbe Prinzip wie DiscordChatExporter) auf die Discord-Schnittstelle zu. Das Automatisieren eines normalen User-Accounts **verstößt gegen die Discord-Nutzungsbedingungen** — Nutzung auf eigenes Risiko, ohne Gewähr. Das Tool liest bewusst langsam und schonend; Nachrichten werden **nur** manuell von dir gesendet, nie automatisch. Halte dich an die Regeln deiner Server.

**Windows warnt beim Start („Windows hat Ihren PC geschützt")?** Das ist normal bei kleinen, nicht signierten Tools. „Weitere Informationen" → „Trotzdem ausführen". Details in [GUIDE.md](GUIDE.md).

---

## Für Technik-Interessierte

Lokale Web-App: **FastAPI + SQLite + SSE** (Backend, Python) und **React + Tailwind** (Frontend, vorgebaut in `frontend/dist/`). Das Backend pollt die Discord-REST-API inkrementell, dazu Nitter-RSS und generische RSS-Feeds als weitere Spaltenquellen. Port **8020**, alles lokal.

Aus dem Quellcode selbst bauen/starten: siehe **[GUIDE.md → „Aus dem Quellcode starten"](GUIDE.md#aus-dem-quellcode-starten-für-entwickler)**.

---

## Lizenz / Haftung

Privates Hobby-Projekt, ohne Gewähr, zur freien Nutzung unter Freunden. Keine Haftung für Account-Sperren, Datenverlust oder sonstige Schäden. Du bist für die Nutzung deines eigenen Discord-Accounts selbst verantwortlich.
