import type { SlideEntry } from '../types';

/**
 * A node in the displayed directory tree. Built from each slide's `path`
 * (e.g. "sub/a/x.svs"): every path segment except the last becomes a `dir`
 * node, the last segment is the `slide` leaf. This reconstructs the on-disk
 * folder structure of a scanned folder for the explorer's tree view.
 */
export type TreeNode = DirNode | SlideNode;

export interface DirNode {
  type: 'dir';
  /** Folder-relative path, unique within a folder (e.g. "sub/a") */
  key: string;
  name: string;
  children: TreeNode[];
}

export interface SlideNode {
  type: 'slide';
  /** The slide's globally-unique entry id */
  key: string;
  entry: SlideEntry;
}

/** A tree node paired with its nesting depth, ready to render as a flat row. */
export interface FlatNode {
  node: TreeNode;
  depth: number;
}

/** Build the nested directory tree for one folder's slides. */
export function buildSlideTree(slides: SlideEntry[]): TreeNode[] {
  const rootChildren: TreeNode[] = [];
  const dirByPath = new Map<string, DirNode>();

  for (const entry of slides) {
    const segments = entry.path.split('/').filter(Boolean);
    let parentChildren = rootChildren;
    let prefix = '';

    // Every segment but the last is a directory; create lazily.
    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i];
      let dir = dirByPath.get(prefix);
      if (!dir) {
        dir = { type: 'dir', key: prefix, name: segments[i], children: [] };
        dirByPath.set(prefix, dir);
        parentChildren.push(dir);
      }
      parentChildren = dir.children;
    }

    parentChildren.push({ type: 'slide', key: entry.id, entry });
  }

  sortNodes(rootChildren);
  return rootChildren;
}

/** Sort each level: directories first, then slides; alphabetical within each. */
function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    const an = a.type === 'dir' ? a.name : a.entry.name;
    const bn = b.type === 'dir' ? b.name : b.entry.name;
    return an.localeCompare(bn);
  });
  for (const n of nodes) {
    if (n.type === 'dir') sortNodes(n.children);
  }
}

/**
 * Flatten the tree into the rows that are currently visible, depth-first.
 * A directory's children are included when it is expanded — i.e. its
 * `${keyPrefix}${dir.key}` is NOT in `collapsed` (or when `expandAll` is set,
 * used while filtering so every match stays visible).
 */
export function flattenVisible(
  nodes: TreeNode[],
  collapsed: Set<string>,
  keyPrefix: string,
  expandAll = false,
  depth = 0,
  out: FlatNode[] = [],
): FlatNode[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.type === 'dir') {
      const isOpen = expandAll || !collapsed.has(`${keyPrefix}${node.key}`);
      if (isOpen) {
        flattenVisible(node.children, collapsed, keyPrefix, expandAll, depth + 1, out);
      }
    }
  }
  return out;
}
