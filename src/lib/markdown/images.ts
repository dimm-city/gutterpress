export const STYLED_IMAGE_REGEX = /!\[([^\]]+)\]\(([^)]+)\)\{([^}]*)\}/g;

const parseAttributeString = (attrString: string): Record<string, string> => {
  const attrMap: Record<string, string> = {};
  const attrPattern = /(\w+)=(['"])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(attrString)) !== null) {
    attrMap[match[1]] = match[3];
  }
  return attrMap;
};

/**
 * Convert `![alt](src){class="foo"}` syntax to `<img>` tags.
 */
export const convertStyledImages = (markdown: string): string => {
  return markdown.replace(STYLED_IMAGE_REGEX, (_, alt, src, attrs) => {
    const attributes = parseAttributeString(attrs.trim());
    const classList = attributes.class
      ? attributes.class.split(/\s+/).filter(Boolean)
      : [];

    const classSegment = classList.length
      ? ` class="${classList.join(" ")}"`
      : "";
    const escapedAlt = String(alt).replace(/"/g, "&quot;");
    return `<img src="${String(src).trim()}" alt="${escapedAlt}"${classSegment}>`;
  });
};

/**
 * Normalize image paths in rendered HTML.
 */
export function fixImagePaths(html: string): string {
  return html
    .replace(/src=["'](\.?\/)?temp\/images\//g, 'src="images/')
    .replace(/src=["'](\.?\/)?images\//g, 'src="images/');
}
