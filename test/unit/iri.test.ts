import { describe, expect, it } from "vitest";
import {
  conceptSlug,
  mintConceptIri,
  mintDocIri,
  mintSchemeIri,
  mintSectionIri,
  normalizeDocPath,
  resolveBaseIri,
} from "../../src/core/iri.js";

describe("resolveBaseIri", () => {
  it("defaults to urn:dockg: when unset", () => {
    expect(resolveBaseIri(undefined)).toBe("urn:dockg:");
  });

  it("appends a trailing slash to http(s) bases missing one", () => {
    expect(resolveBaseIri("https://example.com/kg")).toBe("https://example.com/kg/");
    expect(resolveBaseIri("https://example.com/kg/")).toBe("https://example.com/kg/");
  });

  it("leaves urn-style bases ending in ':' untouched", () => {
    expect(resolveBaseIri("urn:mykg:")).toBe("urn:mykg:");
  });
});

describe("normalizeDocPath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizeDocPath("docs\\guide\\intro.md")).toBe("docs/guide/intro.md");
  });

  it("strips a leading ./", () => {
    expect(normalizeDocPath("./docs/intro.md")).toBe("docs/intro.md");
  });
});

describe("mintDocIri", () => {
  const base = "https://example.com/kg/";

  it("is identical for \\ and / path inputs (OS independence)", () => {
    expect(mintDocIri(base, "docs\\guide\\intro.md")).toBe(
      mintDocIri(base, "docs/guide/intro.md"),
    );
  });

  it("keeps the extension and path segments", () => {
    expect(mintDocIri(base, "docs/intro.md")).toBe(
      "https://example.com/kg/doc/docs/intro.md",
    );
  });

  it("percent-encodes spaces and RFC 3986 reserved characters per segment", () => {
    expect(mintDocIri(base, "docs/getting started.md")).toBe(
      "https://example.com/kg/doc/docs/getting%20started.md",
    );
    expect(mintDocIri(base, "docs/a&b.md")).toBe(
      "https://example.com/kg/doc/docs/a%26b.md",
    );
    expect(mintDocIri(base, "docs/it's(fine)!.md")).toBe(
      "https://example.com/kg/doc/docs/it%27s%28fine%29%21.md",
    );
  });

  it("percent-encodes non-ASCII as UTF-8", () => {
    expect(mintDocIri(base, "docs/café.md")).toBe(
      "https://example.com/kg/doc/docs/caf%C3%A9.md",
    );
  });

  it("works with the urn fallback base", () => {
    expect(mintDocIri("urn:dockg:", "docs/intro.md")).toBe(
      "urn:dockg:doc/docs/intro.md",
    );
  });
});

describe("mintSectionIri", () => {
  it("appends the slug as a fragment", () => {
    expect(mintSectionIri("https://example.com/kg/doc/docs/intro.md", "install")).toBe(
      "https://example.com/kg/doc/docs/intro.md#install",
    );
  });
});

describe("conceptSlug / mintConceptIri", () => {
  it("slugifies labels GitHub-style", () => {
    expect(conceptSlug("Getting Started")).toBe("getting-started");
    expect(conceptSlug("API v2")).toBe("api-v2");
  });

  it("is stateless: identical labels converge on the same slug", () => {
    expect(conceptSlug("setup")).toBe(conceptSlug("setup"));
  });

  it("mints concept IRIs in a shared namespace", () => {
    expect(mintConceptIri("https://example.com/kg/", "Getting Started")).toBe(
      "https://example.com/kg/concept/getting-started",
    );
  });
});

describe("mintSchemeIri", () => {
  it("mints the scheme node", () => {
    expect(mintSchemeIri("https://example.com/kg/")).toBe("https://example.com/kg/scheme");
  });
});
