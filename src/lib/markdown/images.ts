/**
 * Normalize image paths in rendered HTML.
 * Ensures all image paths use relative `images/` format.
 */
export function fixImagePaths(html: string): string {
  return html
    .replace(/src=["'](\.?\/)?temp\/images\//g, 'src="images/')
    .replace(/src=["'](\.?\/)?images\//g, 'src="images/');
}
