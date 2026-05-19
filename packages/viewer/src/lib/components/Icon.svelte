<script lang="ts">
  // Inline Lucide icons (MIT-licensed, https://lucide.dev). We inline a tiny
  // hand-picked subset rather than depending on a 1300-icon SDK — the viewer
  // toolbar only uses ~10 glyphs.
  //
  // To add an icon: copy the path data from https://lucide.dev/icons/<name>
  // and add a new entry below. Lucide SVGs are uniformly 24×24, stroke 2.

  let { name, size = 16 }: { name: IconName; size?: number } = $props();

  type IconName =
    | "folder-open"
    | "chevrons-left"
    | "chevron-left"
    | "chevron-right"
    | "chevrons-right"
    | "rectangle-vertical"
    | "columns-2"
    | "bug"
    | "file-down"
    | "circle-help";

  const ICONS: Record<IconName, string> = {
    "folder-open":
      '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
    "chevrons-left":
      '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
    "chevron-left":
      '<path d="m15 18-6-6 6-6"/>',
    "chevron-right":
      '<path d="m9 18 6-6-6-6"/>',
    "chevrons-right":
      '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
    "rectangle-vertical":
      '<rect width="12" height="20" x="6" y="2" rx="2"/>',
    "columns-2":
      '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
    "bug":
      '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
    "file-down":
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
    "circle-help":
      '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  };
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {@html ICONS[name]}
</svg>
