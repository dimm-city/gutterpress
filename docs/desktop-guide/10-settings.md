---
title: Settings, updates and getting help
description: Change how the app looks and behaves, update it, and get help or report a problem.
---

# Settings, updates and getting help

The gear at the right of the status bar (or Ctrl+, — Cmd+, on a Mac) opens **Settings**, and so
does the **Settings** button at the top of the start screen; the **?** next to the gear opens
**Help**, a tab of the start screen.

## Settings

Settings is one page, the same whether a book is open or not. Every change applies at once: there
is nothing to save.

- **Appearance** — the **Theme** (**Match system**, **Light** or **Dark**), and **Mark problems
  in the editor**, which underlines the lines the Problems list mentions.
- **Saving** — **Save changes automatically** (when it's off, press Ctrl+S to save), **Keep
  previous versions** and **Back up online automatically** (see
  [Keep versions and back up your work](09-versions-and-backup.md)).
- **Your name and email** — saved with each version, so a book's history shows who changed what.
- **Accounts** — the accounts saved on this computer: **GitHub** (with **Connect GitHub…** or
  **Disconnect**), then any publishing keys and Git servers, each with **Remove**. Publishing
  accounts are added when you [publish](08-publish.md), and another Git server is added in the
  book's **Setup → Backup**.

![Settings: Appearance, Saving, your name and email, and Accounts](images/settings.jpg)

## Updates

Gutterpress checks for updates itself and shows **Update available** with a **Download** button,
then **Update ready — Restart & update** once it has downloaded. On a Mac, the update downloads
from GitHub for you to install. To check yourself, open the start screen's **Troubleshooting** tab,
then **Diagnostics**, and click **Check now**. Diagnostics also shows which version you're running.

The **Update channel**, also under Troubleshooting → Diagnostics, is **Stable — recommended**
unless you choose **Beta** or **Alpha** for early builds. On Linux, the same place has **Add to
application menu**, which adds the AppImage to your desktop's menu.

## Get help or report a problem

The start screen's **Help** tab has help on using the app, and these guides are always at
[gutterpress.dimm.city/docs](https://gutterpress.dimm.city/docs/).

To report a problem, open **Troubleshooting → Report a problem** and answer its questions: a
short summary, what happened, what you expected, and the steps that show it. **Open GitHub
issue** opens the issue form with your answers, your app and system versions, how the book is
set up (not its text) and the end of the app's log already filled in; nothing is sent until you
create the issue. On GitHub, drag any screenshots or sample files into **Screenshots or files**,
since the app can't attach them for you. **Copy report** copies the same details. Error messages
also offer **Report a problem**. The **Logs** and **Diagnostics** tabs help when something isn't
working, and with a book open, **Open terminal in book folder** on the **Diagnostics** tab opens
a terminal there (bash; on Windows, a Command Prompt when bash isn't installed).
