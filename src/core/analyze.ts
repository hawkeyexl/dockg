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
import type { RouteMapping } from "./config.js";
import { normalizeDocPath } from "./iri.js";

export interface AnalyzeOptions {
  /** Site-route mappings for resolving root-absolute links. */
  routes?: RouteMapping[];
}

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

const HAS_EXTENSION = /\.[a-z0-9]+$/i;

/** Slug normalization for route matching: lowercase, dashes/underscores stripped. */
function slugNorm(path: string): string {
  return path.toLowerCase().replace(/[-_]/g, "");
}

/**
 * Tiered lookup over the corpus: exact path, then case-insensitive, then
 * slug-normalized (published slugs are often kebab-cased versions of
 * camelCase filenames, e.g. Fern's /stop-record for stopRecord.mdx).
 * Ambiguous fallback matches (two files normalizing identically) stay
 * unresolved rather than guessing.
 */
class PathIndex {
  private readonly lower = new Map<string, string | null>();
  private readonly slugged = new Map<string, string | null>();

  constructor(private readonly exact: ReadonlySet<string>) {
    for (const path of exact) {
      const lower = path.toLowerCase();
      this.lower.set(lower, this.lower.has(lower) ? null : path);
      const slug = slugNorm(path);
      this.slugged.set(slug, this.slugged.has(slug) ? null : path);
    }
  }

  resolve(candidate: string): string | undefined {
    if (this.exact.has(candidate)) return candidate;
    return (
      this.lower.get(candidate.toLowerCase()) ??
      this.slugged.get(slugNorm(candidate)) ??
      undefined
    );
  }
}

/**
 * Resolve a root-absolute route (`/docs/actions/find`) to a source file via
 * the configured mappings. Returns the repo path, "broken" when a mapping's
 * basePath matched but no candidate file exists, or null when no mapping
 * covers the route.
 */
function resolveRoute(
  pathPart: string,
  routes: RouteMapping[],
  index: PathIndex,
): string | "broken" | null {
  const clean = pathPart.replace(/\/+$/, "");
  let anyMatched = false;
  for (const mapping of routes) {
    if (clean !== mapping.basePath && !clean.startsWith(`${mapping.basePath}/`)) {
      continue;
    }
    anyMatched = true;
    const rest = clean.slice(mapping.basePath.length).replace(/^\/+/, "");
    const prefix = mapping.root ? `${mapping.root}/` : "";

    const candidates: string[] = [];
    if (rest !== "" && HAS_EXTENSION.test(rest)) {
      candidates.push(`${prefix}${rest}`);
    } else {
      if (rest !== "") {
        for (const ext of mapping.extensions) candidates.push(`${prefix}${rest}${ext}`);
      }
      const dir = rest === "" ? prefix : `${prefix}${rest}/`;
      for (const indexFile of mapping.indexFiles) {
        for (const ext of mapping.extensions) candidates.push(`${dir}${indexFile}${ext}`);
      }
    }
    for (const candidate of candidates) {
      const resolved = index.resolve(candidate);
      if (resolved) return resolved;
    }
  }
  return anyMatched ? "broken" : null;
}

/** One PathIndex per corpus set — analyzeDoc is called once per doc over the same set. */
const indexCache = new WeakMap<ReadonlySet<string>, PathIndex>();

function pathIndexFor(allPaths: ReadonlySet<string>): PathIndex {
  let index = indexCache.get(allPaths);
  if (!index) {
    index = new PathIndex(allPaths);
    indexCache.set(allPaths, index);
  }
  return index;
}

function classifyLink(
  docPath: string,
  rawTarget: string,
  allPaths: ReadonlySet<string>,
  routes: RouteMapping[],
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
  // Site-root-absolute URLs (/docs/x/) are published-site routes. With route
  // mappings configured they resolve to source files (or count as broken when
  // a mapped basePath has no matching file); unmapped routes are skipped.
  if (pathPart.startsWith("/")) {
    const resolved = resolveRoute(pathPart, routes, pathIndexFor(allPaths));
    if (resolved === null) return null;
    if (resolved === "broken") return { raw, kind: "broken" };
    const link: DocLink = { raw, kind: "internal", resolvedPath: resolved };
    if (anchor) link.anchor = anchor;
    return link;
  }
  const resolved = resolveRelative(docPath, decodeURIComponent(pathPart));
  if (resolved !== null) {
    const index = pathIndexFor(allPaths);
    const hadTrailingSlash = pathPart.endsWith("/");
    const candidates: string[] = [];
    if (allPaths.has(resolved)) {
      candidates.push(resolved);
    } else if (!HAS_EXTENSION.test(resolved)) {
      // Extensionless relative links are route-style: try extensions, then
      // index files for directory targets.
      if (!hadTrailingSlash) {
        for (const ext of DEFAULT_LINK_EXTENSIONS) candidates.push(`${resolved}${ext}`);
      }
      const dir = resolved === "" ? "" : `${resolved}/`;
      for (const indexFile of DEFAULT_INDEX_FILES) {
        for (const ext of DEFAULT_LINK_EXTENSIONS) {
          candidates.push(`${dir}${indexFile}${ext}`);
        }
      }
    }
    for (const candidate of candidates) {
      const hit = index.resolve(candidate);
      if (hit) {
        const link: DocLink = { raw, kind: "internal", resolvedPath: hit };
        if (anchor) link.anchor = anchor;
        return link;
      }
    }
  }
  return { raw, kind: "broken" };
}

const DEFAULT_LINK_EXTENSIONS = [".md", ".mdx"];
const DEFAULT_INDEX_FILES = ["index", "README"];

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
  options: AnalyzeOptions = {},
): DocModel {
  const routes = options.routes ?? [];
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
        const link = classifyLink(path, (node as { url: string }).url, allPaths, routes);
        if (link) links.push(link);
        break;
      }
      case "linkReference": {
        const def = definitions.get((node as { identifier: string }).identifier);
        if (def) {
          const link = classifyLink(path, def.url, allPaths, routes);
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
