<script lang="ts">
  /**
   * HelpContent — the Help tab: guidance only (getting started, online-copy
   * guide, keyboard shortcuts). Diagnostics, logs, versions and updates live
   * in the Troubleshooting tab (TroubleshootingView).
   *
   * Help lives on the welcome screen's Help tab (WelcomeLanding), opened by the global help
   * button. Static copy — no host calls; the host passes the setup-guide opener.
   */
  let { onOpenGuide }: { onOpenGuide?: () => void } = $props();

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
  const modKey = isMac ? "Cmd" : "Ctrl";
</script>

<div class="help-content">
  <p class="intro">How to open, edit, save and publish your book.</p>

  <section class="getting-started">
    <h3>Getting Started</h3>
    <ol class="steps">
      <li><strong>Open your book folder</strong> — on the welcome screen, click <em>Open a folder</em> (or pick a book from <em>Your books</em>) and choose the folder that contains your <code>manifest.yaml</code> file. Once a book is open, click the folder button at the left of the status bar (<em>Books — open the start screen</em>) to get back to your list of books.</li>
      <li><strong>Browse your document</strong> — use the arrow keys or Page Up/Down to flip through pages. Click <em>Read</em> in the toolbar to see two pages side by side like an open book, and use the magnifier menu to zoom.</li>
      <li><strong>Edit your pages</strong> — click <em>Edit</em> (or press {modKey}+E) to open the markdown editor beside the preview. By default your changes save automatically, and {modKey}+S or the Save button saves immediately. To save only when you choose, turn off <em>Save edits automatically</em> under Settings &gt; Saving (open Settings with the gear icon in the bottom-right corner).</li>
      <li><strong>Keep versions of your work</strong> — click the save status in the bottom-right corner to open <em>Where your work is kept</em>: save a version, see previous versions, and back up online.</li>
      <li><strong>Publish</strong> — click <em>Publish</em> to save a PDF or website to a folder and send it on (or press {modKey}+Shift+E to save a PDF directly).</li>
    </ol>
    <p class="gs-note">Don't have a book yet? Visit the <button class="inline-link" onclick={onOpenGuide}>online setup guide</button> to create one.</p>
  </section>

  <section class="online-copy">
    <h3>Work with an Online Copy</h3>
    <ul class="steps">
      <li><strong>Open from GitHub</strong> — click <em>Open from GitHub</em> on the welcome screen (from an open book, the folder button at the left of the status bar takes you there) to connect your GitHub account, choose a repository, and download a copy of the book to your computer.</li>
      <li><strong>Back up now</strong> — when your book is backed up online, click the save status in the bottom-right corner (it says <em>Edits saved</em>) to open <em>Where your work is kept</em>, then click <em>Back up now</em> under <em>Online backup</em>. If you're offline, your work stays saved on this computer and the backup catches up when you're back online. If your copy and the online copy both changed, Gutterpress lists each file that differs and lets you choose: keep your version, use the online version, or keep both copies.</li>
      <li><strong>Other hosting services</strong> — if your book lives somewhere other than GitHub, open the gear icon in the bottom-right corner, then <em>Accounts</em>, to connect a Git server (such as Gitea or Forgejo).</li>
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
  .steps code { font-family: var(--app-font-mono); color: light-dark(#2b4a6f, #99aabb); background: light-dark(#e8edf5, #2a3040); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
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
