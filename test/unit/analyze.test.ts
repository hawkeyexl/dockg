import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../src/core/analyze.js";

const ALL = new Set(["docs/intro.md", "docs/config.md", "docs/sub/deep.md"]);

describe("analyzeDoc — frontmatter", () => {
  it("extracts frontmatter data via docmeta", () => {
    const doc = analyzeDoc(
      "---\ntitle: Intro\ntags: [setup]\n---\n\n# Hello\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.frontmatterPresent).toBe(true);
    expect(doc.frontmatter).toEqual({ title: "Intro", tags: ["setup"] });
  });

  it("handles a doc without frontmatter", () => {
    const doc = analyzeDoc("# Just a heading\n", "docs/intro.md", ALL);
    expect(doc.frontmatterPresent).toBe(false);
    expect(doc.frontmatter).toEqual({});
  });

  it("handles CRLF files", () => {
    const doc = analyzeDoc(
      "---\r\ntitle: Win\r\n---\r\n\r\n# Heading\r\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.frontmatter).toEqual({ title: "Win" });
    expect(doc.sections).toHaveLength(1);
  });
});

describe("analyzeDoc — headings", () => {
  it("builds a section list with levels, slugs, order, and parents", () => {
    const doc = analyzeDoc(
      "# Title\n\n## Install\n\ntext\n\n## Usage\n\n### Advanced\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.firstH1).toBe("Title");
    expect(doc.sections).toEqual([
      { slug: "title", title: "Title", level: 1, order: 1, parentSlug: null },
      { slug: "install", title: "Install", level: 2, order: 1, parentSlug: "title" },
      { slug: "usage", title: "Usage", level: 2, order: 2, parentSlug: "title" },
      { slug: "advanced", title: "Advanced", level: 3, order: 1, parentSlug: "usage" },
    ]);
  });

  it("disambiguates duplicate headings in document order", () => {
    const doc = analyzeDoc("## Setup\n\n## Setup\n", "docs/intro.md", ALL);
    expect(doc.sections.map((s) => s.slug)).toEqual(["setup", "setup-1"]);
  });

  it("attaches level-skipping headings to the nearest shallower ancestor", () => {
    const doc = analyzeDoc("# Top\n\n### Deep\n", "docs/intro.md", ALL);
    expect(doc.sections[1]).toMatchObject({ slug: "deep", parentSlug: "top" });
  });

  it("handles headings before any shallower heading (parent = doc)", () => {
    const doc = analyzeDoc("### Orphan\n\n# Later\n", "docs/intro.md", ALL);
    expect(doc.sections[0]).toMatchObject({ slug: "orphan", parentSlug: null, order: 1 });
    expect(doc.sections[1]).toMatchObject({ slug: "later", parentSlug: null, order: 2 });
  });
});

describe("analyzeDoc — links", () => {
  it("classifies internal, external, and broken links", () => {
    const doc = analyzeDoc(
      "[a](config.md) [b](https://example.com/x) [c](missing.md)\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.links).toEqual([
      { raw: "config.md", kind: "internal", resolvedPath: "docs/config.md" },
      { raw: "https://example.com/x", kind: "external", url: "https://example.com/x" },
      { raw: "missing.md", kind: "broken" },
    ]);
  });

  it("resolves relative traversal and anchors", () => {
    const doc = analyzeDoc(
      "[up](../intro.md#install) [peer](deep.md)\n",
      "docs/sub/deep.md",
      new Set(["docs/intro.md", "docs/sub/deep.md"]),
    );
    expect(doc.links[0]).toEqual({
      raw: "../intro.md#install",
      kind: "internal",
      resolvedPath: "docs/intro.md",
      anchor: "install",
    });
  });

  it("ignores same-document anchor links", () => {
    const doc = analyzeDoc("[here](#install)\n", "docs/intro.md", ALL);
    expect(doc.links).toEqual([]);
  });

  it("ignores site-root-absolute links (published-site routes, not repo paths)", () => {
    const doc = analyzeDoc("[route](/docs/config/)\n", "docs/intro.md", ALL);
    expect(doc.links).toEqual([]);
  });

  it("resolves reference-style links via definitions", () => {
    const doc = analyzeDoc(
      "[a][ref]\n\n[ref]: config.md\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.links).toEqual([
      { raw: "config.md", kind: "internal", resolvedPath: "docs/config.md" },
    ]);
  });

  it("marks links escaping the root as broken", () => {
    const doc = analyzeDoc("[out](../../outside.md)\n", "docs/intro.md", ALL);
    expect(doc.links).toEqual([{ raw: "../../outside.md", kind: "broken" }]);
  });
});

describe("analyzeDoc — images and code", () => {
  it("collects images with resolved targets", () => {
    const doc = analyzeDoc(
      "![alt](img/a.png)\n![ext](https://example.com/b.png)\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.images).toEqual([
      { raw: "img/a.png", target: "docs/img/a.png", external: false },
      { raw: "https://example.com/b.png", target: "https://example.com/b.png", external: true },
    ]);
  });

  it("collects distinct fenced code languages, sorted", () => {
    const doc = analyzeDoc(
      "```python\nx\n```\n\n```bash\ny\n```\n\n```python\nz\n```\n\n```\nplain\n```\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.codeLanguages).toEqual(["bash", "python"]);
  });
});
