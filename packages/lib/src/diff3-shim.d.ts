/**
 * Minimal typings for the `diff3` package (the same three-way text merge
 * isomorphic-git uses internally as its default merge driver). Used by the
 * sync conflict-resolution driver (remote-auth/sync.ts) so files the
 * author did NOT choose about still auto-merge exactly like a normal merge.
 */
declare module "diff3" {
  interface Diff3MergeRegion {
    ok?: string[];
    conflict?: { a: string[]; aIndex: number; b: string[]; bIndex: number; o: string[]; oIndex: number };
  }
  function diff3Merge(
    a: string[] | string,
    o: string[] | string,
    b: string[] | string,
  ): Diff3MergeRegion[];
  export = diff3Merge;
}
