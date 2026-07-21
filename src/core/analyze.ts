/**
 * Markdown analysis: one source file → a `DocModel`. Frontmatter data comes
 * from docmeta's extractor (single source of truth with `dockg validate`);
 * body structure (headings, links, images, code fences) comes from a
 * remark/mdast walk with positions in document order.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { toString as mdastToString } from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import { extractFrontmatter } from "docmeta";
import type { Root, Content, Definition } from "mdast";
import type { DocImage, DocLink, DocModel, Section } from "../types.js";
import { normalizeDocPath } from "./iri.js";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"]);

/** True when the target has a URI scheme (http:, https:, mailto:, ...). */
function hasScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/**
 * Resolve a relative link target against the linking doc's directory using
 * pure string math (posix, OS-independent). Returns null when the target
 * escapes the corpus root.
 */
function resolveRelative(docPath: string, target: string): string | null {
  const baseSegments = normalizeDocPath(docPath).split("/").slice(0, -1);
  const segments = [...baseSegments];
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join("/");
}

function classifyLink(
  docPath: string,
  rawTarget: string,
  allPaths: ReadonlySet<string>,
): DocLink | null {
  const raw = rawTarget;
  if (hasScheme(raw)) {
    try {
      return { raw, kind: "external", url: new URL(raw).href };
    } catch {
      // Scheme-bearing but unparseable — example junk, not a link. Skip.
      return null;
    }
  }
  const hashAt = raw.indexOf("#");
  const pathPart = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const anchor = hashAt === -1 ? undefined : raw.slice(hashAt + 1);
  if (pathPart === "") return null; // same-document anchor
  // Site-root-absolute URLs (/docs/x/) are published-site routes, not repo
  // paths — unresolvable without site mapping, so neither internal nor broken.
  if (pathPart.startsWith("/")) return null;
  const resolved = resolveRelative(docPath, decodeURIComponent(pathPart));
  if (resolved !== null && allPaths.has(resolved)) {
    const link: DocLink = { raw, kind: "internal", resolvedPath: resolved };
    if (anchor) link.anchor = anchor;
    return link;
  }
  return { raw, kind: "broken" };
}

function classifyImage(
  docPath: string,
  rawTarget: string,
): DocImage {
  if (hasScheme(rawTarget)) {
    return { raw: rawTarget, target: rawTarget, external: true };
  }
  const resolved = resolveRelative(docPath, rawTarget);
  return { raw: rawTarget, target: resolved ?? rawTarget, external: false };
}

/** Analyze one Markdown file. `allPaths` is the discovered corpus for link resolution. */
export function analyzeDoc(
  content: string,
  relPath: string,
  allPaths: ReadonlySet<string>,
): DocModel {
  const path = normalizeDocPath(relPath);
  const meta = extractFrontmatter(content, "markdown");
  const tree = processor.parse(content) as Root;

  const sections: Section[] = [];
  const links: DocLink[] = [];
  const images: DocImage[] = [];
  const codeLanguages = new Set<string>();
  const definitions = new Map<string, Definition>();
  let firstH1: string | undefined;

  // First pass: collect reference-link definitions.
  visit(tree, (node) => {
    if (node.type === "definition") {
      const def = node as Definition;
      definitions.set(def.identifier, def);
    }
  });

  const slugger = new GithubSlugger();
  /** Stack of open sections: [level, slug]. */
  const stack: Array<{ level: number; slug: string }> = [];
  /** Child counters keyed by parent slug ("" = document). */
  const childCount = new Map<string, number>();

  visit(tree, (node) => {
    switch (node.type) {
      case "heading": {
        const level = (node as { depth: number }).depth;
        const title = mdastToString(node);
        const slug = slugger.slug(title);
        if (level === 1 && firstH1 === undefined) firstH1 = title;
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
          stack.pop();
        }
        const parentSlug = stack.length > 0 ? stack[stack.length - 1]!.slug : null;
        const parentKey = parentSlug ?? "";
        const order = (childCount.get(parentKey) ?? 0) + 1;
        childCount.set(parentKey, order);
        sections.push({ slug, title, level, order, parentSlug });
        stack.push({ level, slug });
        break;
      }
      case "link": {
        const link = classifyLink(path, (node as { url: string }).url, allPaths);
        if (link) links.push(link);
        break;
      }
      case "linkReference": {
        const def = definitions.get((node as { identifier: string }).identifier);
        if (def) {
          const link = classifyLink(path, def.url, allPaths);
          if (link) links.push(link);
        }
        break;
      }
      case "image": {
        images.push(classifyImage(path, (node as { url: string }).url));
        break;
      }
      case "imageReference": {
        const def = definitions.get((node as { identifier: string }).identifier);
        if (def) images.push(classifyImage(path, def.url));
        break;
      }
      case "code": {
        const lang = (node as { lang?: string | null }).lang;
        if (lang) codeLanguages.add(lang);
        break;
      }
    }
  });

  return {
    path,
    frontmatter: meta.data,
    frontmatterPresent: meta.present,
    firstH1,
    sections,
    links,
    images,
    codeLanguages: [...codeLanguages].sort(),
  };
}

/** Minimal depth-first mdast walk in document order. */
function visit(node: Root | Content, fn: (node: Content) => void): void {
  const children = (node as { children?: Content[] }).children;
  if (!children) return;
  for (const child of children) {
    fn(child);
    visit(child, fn);
  }
}
