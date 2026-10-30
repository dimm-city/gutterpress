<script lang="ts">
  /**
   * HelpContent — the Help tab: guidance only (getting started, online-copy
   * guide, keyboard shortcuts). Versions, updates, the update channel, desktop
   * integration, diagnostics and logs live in the Troubleshooting tab
   * (TroubleshootingView → Diagnostics).
   *
   * Help lives on the welcome screen's Help tab (WelcomeLanding), opened by the global help
   * button. Static copy — no host calls; the host passes the setup-guide opener.
   */
  let { onOpenGuide }: { onOpenGuide?: () => void } = $props();

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
  const modKey = isMac ? "Cmd" : "Ctrl";
</script>

<div class="help-content">
  <p class="intro">How to open, edit, set up, save and publish your book.</p>

  <section class="getting-started">
    <h3>Getting Started</h3>
    <ol class="steps">
      <li><strong>Open your book folder</strong> — on the welcome screen, click <em>Open a folder</em> (or pick a book from <em>Your books</em>) and choose your book's folder. Once a book is open, click the folder button at the left of the status bar (<em>Books — open the start screen</em>) to get back to your list of books.</li>
      <li><strong>Browse your document</strong> — use the arrow keys or Page Up/Down to flip through pages. Click <em>Read</em> in the toolbar to see two pages side by side like an open book, and use the magnifier menu to zoom.</li>
      <li><strong>Edit your pages</strong> — click <em>Edit</em> (or press {modKey}+E) to open the markdown editor beside the preview. By default your changes save automatically, and {modKey}+S or the Save button saves immediately. To save only when you choose, turn off <em>Save changes automatically</em> under Settings &gt; Saving (open Settings with the gear icon in the bottom-right corner).</li>
      <li><strong>Set up and style your book</strong> — click <em>Setup</em> in the toolbar: <em>Book</em> for the title, authors, page size, margins and chapters; <em>Look</em> to choose a look (the book's overall design) and adjust its fonts and colors; <em>Extensions</em> to turn on extras such as callouts or math.</li>
      <li><strong>Keep versions of your work</strong> — click the save status at the bottom left of the window to open <em>Online copy</em> in Book setup: save a version, see your version history, switch between revisions, and back up to your online copy.</li>
      <li><strong>Publish</strong> — click <em>Publish</em> to save a PDF or website to a folder and send it on (or press {modKey}+Shift+E to save a PDF directly).</li>
    </ol>
    <p class="gs-note">Don't have a book yet? Visit the <button class="inline-link" onclick={onOpenGuide}>online setup guide</button> to create one.</p>
  </section>

  <section class="online-copy">
    <h3>Work with an Online Copy</h3>
    <ul class="steps">
      <li><strong>Open from GitHub</strong> — click <em>Open from GitHub</em> on the welcome screen (from an open book, the folder button at the left of the status bar takes you there) to sign in to your GitHub account, choose the book's online copy, and download the book to your computer.</li>
      <li><strong>Back up</strong> — Gutterpress backs up your book while you work, and the save status at the bottom left says <em>Backed up</em> when it has. To back up straight away, click the save status to open <em>Online copy</em> in Book setup, then click <em>Back up now</em>; <em>Get latest</em> beside it brings in the changes from the online copy without sending yours. If you turn off <em>Back up online automatically</em> under Settings &gt; Saving, <em>Get latest</em> and <em>Sync</em> sit beside the save status: <em>Sync</em> gets the latest changes from the online copy, then backs up yours. If you're offline, your work stays saved on this computer and backing up catches up when you're back online. If this computer's files and the online copy both changed the same passage, Gutterpress combines both sides and marks the overlapping passage as two takes in the file; you choose in the editor: keep yours, keep online, or keep both.</li>
      <li><strong>Other hosting services</strong> — if your book lives somewhere other than GitHub, open the book's <em>Setup</em>, then <em>Online copy</em>, to sign in to its Git server (such as Gitea or Forgejo).</li>
    </ul>
  </section>

  <section class="shortcuts">
    <h3>Keyboard Shortcuts</h3>
    <table>
      <thead>
        <tr><th>Action</th><th>Keys</th></tr>
      </thead>
      <tbody>
        <tr><td>Navigate pages</td><td>Left / Right arrow keys, Page Up/Down</td></tr>
        <tr><td>First / Last page</td><td>Home / End</td></tr>
        <tr><td>Zoom in / out</td><td>+ / -</td></tr>
        <tr><td>Fit to width</td><td>F</td></tr>
        <tr><td>Toggle editor (Edit mode)</td><td>{modKey}+E</td></tr>
        <tr><td>Leave Focus (Focus is in the toolbar)</td><td>Esc</td></tr>
        <tr><td>Save source edits</td><td>{modKey}+S</td></tr>
        <tr><td>Save PDF</td><td>{modKey}+Shift+E</td></tr>
        <tr><td>Settings</td><td>{modKey}+,</td></tr>
      </tbody>
    </table>
  </section>
</div>

<style>
  .help-content { font-size: 13px; color: var(--app-text-secondary); }
  .intro { margin: 0 0 18px; font-size: 12px; color: var(--app-text-muted); }

  /* Getting Started + Work with an Online Copy sections (same treatment) */
  .getting-started, .online-copy { margin-bottom: 18px; }
  .getting-started h3, .online-copy h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .steps { margin: 0 0 10px; padding-left: 20px; font-size: 13px; line-height: 1.6; color: var(--app-text-secondary); }
  .steps li { margin-bottom: 6px; }
  .gs-note { margin: 0; font-size: 12px; color: var(--app-text-muted); }
  .inline-link { background: none; border: none; color: var(--app-link); cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; text-underline-offset: 2px; }
  .inline-link:hover { color: var(--app-link-hover); }

  .shortcuts { margin-bottom: 18px; }
  .shortcuts h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .shortcuts table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .shortcuts td { padding: 5px 8px; }
  .shortcuts tr:nth-child(even) td { background: var(--app-surface-raised); }
  .shortcuts td:last-child { font-family: var(--app-font-mono); color: light-dark(#2b4a6f, #99aabb); }
  .shortcuts th { text-align: left; padding: 5px 8px; font-size: 11px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.3px; border-bottom: 1px solid var(--app-border-subtle); }
</style>
