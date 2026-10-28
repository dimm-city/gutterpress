---
title: Keep versions and back up your work
description: How Gutterpress saves your edits, keeps earlier versions you can go back to, and backs your book up online.
---

# Keep versions and back up your work

## Where your work is kept

The indicator in the status bar shows whether your edits are saved: **Edits saved**,
**Saving…**, **Unsaved changes** or **Couldn't save**. Click it to open **Where your work is
kept**, which has three parts:

- **Saving** — **Save now** saves immediately.
- **Versions** — **Save a version now** keeps a copy of the book as it is, and **See previous
  versions** lists them. If the book is a plain folder, **Start keeping versions** turns this on.
- **Online backup** — **Back up now** copies your versions to your online backup.

Next to the indicator, a status shows the online backup: for example **Backed up online**,
**Backing up…**, **Not backed up online**, or **Offline — edits are saved on this computer**.

![Where your work is kept: Saving, Versions and Online backup](images/where-your-work-is-kept.jpg)

## See what each version changed

Click the save indicator, then **See previous versions**, to open **Versions**. Each version
shows when it was made and what it changed: a short list of files with a plain hint, such as
`chapter-02.md · 3 paragraphs changed`, `styles/book.css · 1 rule changed` or
`art/cover.png · replaced`. An automatic version that changed nothing says **No changes**.
When the book has an online copy, each version also says **Backed up** or **On this computer
only**.

- **Look at this version** shows that version beside the current book in the preview, on the
  same page, so you can compare them as they print. Nothing on disk changes. Click **Stop
  looking** (or the **×** in the preview's bar) to return to the live preview.
- Click a changed file to see **That version** and **Current** side by side, with the lines that
  differ marked. This view is for reading only; go back to the versions list with the
  **Versions** button at the top.
- In a narrow window there is room for one page at a time: the bar above the preview offers
  **That version** and **Current book**.
- When new changes are online that this computer has not got, the list starts with **Online,
  not yet on this computer**, showing those versions and their changed files. Use **Get
  latest** to bring them in.

## Go back to an earlier version

1. Open **Versions** as above.
2. Find the version you want and click **Restore this version**.
3. Confirm with **Yes, restore**. Gutterpress saves your current work as a version first, so
   nothing is lost.

![Previous versions, each with Restore this version](images/previous-versions.jpg)

## Back up online

Online backup keeps a copy of your book's versions on GitHub (or another Git server). **Setup →
Backup** says in one line where the book is kept, and offers the one next step:

- **Previous versions are off for this book.** The book is a plain folder. Click **Turn on
  previous versions** to keep earlier versions on this computer. Nothing is uploaded.
- **Saved on this computer only.** The book has versions but no online copy yet: see
  [Set up online backup for a book you started here](#set-up-online-backup-for-a-book-you-started-here).
- **This book's online copy is on GitHub: …. Connect GitHub to back it up.** Click **Connect
  GitHub…** and enter the code it shows on the GitHub page that opens (**Copy code** copies it;
  **Open GitHub again** reopens the page). The book backs up as soon as you are connected. A book you opened with
  [Open from GitHub](02-books.md#open-a-book-from-github) is already connected.
- **This book's online copy is on git.example.com. Connect it to back the book up.** See
  [Back up to another Git server](#back-up-to-another-git-server).
- **Online copy: ….** The book is connected to its online copy. Once a backup has run, the line
  says how it went: **Backed up online to … · last backup 2 mins ago**, or **Couldn't back up to
  …** with the reason and **Try again** (or, when the server no longer accepts the saved sign-in,
  the connect step again). With automatic backup off, it says so and offers **Back up now**. When
  the book has more than one copy, **Copy you're working on** shows which: choose another and
  click **Switch** to work on it.
- **This book's online copy uses an SSH address (git@…).** Gutterpress can't back up over SSH.
  Keep backing up with your usual Git tool, or give the book its https:// address with that tool
  (`git remote set-url origin https://…`) and come back to connect it.

GitHub can also be connected in Settings → **Accounts**, which lists every account saved on this
computer, each with **Remove**.

### Set up online backup for a book you started here

1. Click the save indicator, then **Set up online backup…** under **Online backup**. This opens
   **Setup → Backup**.
2. If the book is a plain folder, click **Turn on previous versions** first. Online backup copies
   the versions Gutterpress keeps, so it needs them.
3. Under **Back it up online**, click **Connect GitHub…** if GitHub isn't connected yet, and enter
   the code shown on the GitHub page that opens.
4. Choose where the copy goes:
   - The **Repository name** starts as your book's title and you can change it. **Private: only
     you can see it** is on by default.
   - Or click **Use an empty repository you already made** and pick one from the list.
     Repositories that look empty are listed. To make one, click **Open github.com to create
     one…** and leave "Add a README" off.
5. Click **Back up to GitHub**. Gutterpress connects the book to the repository and copies all of
   its earlier versions there. When it finishes, the status bar shows **Backed up online** and the
   book works like one opened from GitHub.

If something goes wrong, Gutterpress says what happened in plain words and leaves your book as it
was. The common cases:

- **A repository with that name already exists** — pick another name, or choose that repository
  from the empty ones.
- **The repository already has files** — online backup needs an empty one. Choose another, or
  create a new one.
- **No internet connection** — nothing was changed; try again when you are back online.
- **GitHub didn't accept the saved connection** — sign in again with Troubleshooting → **Sync** →
  **Reconnect GitHub…**, then try again.
- **The copy didn't go through after the repository was created** — the empty repository is kept
  and selected; click **Try again** to use it.

Settings → **Saving** has the switches: **Save changes automatically**, **Keep previous versions**
and **Back up online automatically**.

### Back up to another Git server

Gutterpress also backs up to GitLab, Gitea, Forgejo, Bitbucket, Azure Repos and other Git servers,
over their https:// address. It doesn't create repositories there, so the book starts from a copy
on the server:

1. Put the book in a repository on your server with your usual Git tool, or clone one that is
   already there.
2. Open the book's folder in Gutterpress, then **Setup → Backup**. It names the server the book's
   online copy is on.
3. Create an access token on that server, paste it under **Access token** (with your **Username**
   if the server needs one) and click **Connect**. The token is checked with the server before it
   is saved. For a server Gutterpress recognises, **Create a token on …** opens the page that
   makes one; for any other, **How to make an access token** opens this section.

Where each server makes its tokens:

- **Gitea or Forgejo:** Settings > Applications.
- **GitLab:** Preferences > Access tokens, with read and write access to repositories.
- **Bitbucket:** Personal settings > App passwords, with repository read and write.
- **Azure Repos:** User settings > Personal access tokens, with Code read & write.

If backing up keeps failing, Troubleshooting → **Sync** has **Test the connection**, which checks
whether Gutterpress can reach the book's online copy without changing anything.

### Get and send changes yourself

To get changes from online and send yours only when you choose, turn off **Back up online
automatically** in Settings. The status bar then shows two buttons next to the online status:

- **Get latest** brings in the changes from online and sends nothing back. Your own edits stay
  on this computer.
- **Back up now** gets the latest first, then sends your changes.

Both buttons are also in **Where your work is kept**. While automatic backup is off, Gutterpress
checks for new changes online every few minutes and when you come back to the window. When it
finds some, a message says **New changes are online for this book**, with a **Get latest**
button.

### When your changes and the online copy overlap

If you and someone else edited the same passage, getting the latest changes keeps both versions
in the file and tells you so: **Two versions of a passage were kept in chapter-02.md — yours and
the online version. Choose which to keep in the editor**, with a **Review** button. Nothing is
lost, but the book will not export until you choose.

1. Click **Review**, or open the Problems list from the editor toolbar. Each passage with two
   versions is listed as **Two versions**; click one to open its file.
2. A card above the text asks, one passage at a time, which version you want to keep: **Keep
   yours**, **Keep online** or **Keep both**. The editor scrolls to that passage, and the preview
   shows both versions in the page, each in a labelled box, so you can read either one as it
   would print. **Compare the text** shows the two texts in the card, with the words only one
   side has marked (two texts that differ only in spacing say so). With several passages, the
   count and arrows in the card's corner move between them.
3. Click your choice. The file is updated right away, the card moves on to the next passage, and
   a message confirms it with an **Undo** button. **Keep both** puts your version first and the
   online version after it, as two paragraphs.

When the last passage in a file is settled, a message offers the **Next file** that has one.
Undo in the text (Ctrl+Z, or Cmd+Z on a Mac) also brings both versions back. Stylesheets work
the same way, rule by rule, and so does the book's settings file: while `manifest.yaml` holds
two versions of a setting the preview shows **This book's settings have two versions** instead
of a page, and comes back on its own once you choose.

If a passage's two texts look nothing alike, someone online may have rewritten or removed
paragraphs above it, so the two sides are offset by a paragraph from there on. Keep the same
side all the way down the chapter, or keep both and tidy the text afterwards.

A picture or other file that cannot hold two versions is kept as two files instead, the online
one named `cover.online.png` beside your `cover.png`. Keep the one you want and delete the other
from the Files list.

Next: [settings, updates and getting help](10-settings.md).
