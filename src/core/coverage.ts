/**
 * Metadata coverage fields (ADR 01011). Coverage answers the ADR 01008
 * question — what can a graph-side consumer see — by counting `dockg:Document`
 * nodes that carry each predicate. The list is fixed and deliberate: a
 * predicate absent from every document still shows as 0%, which a dynamic
 * census could not surface. It is shared between the config parser (which
 * expands a uniform threshold across every field) and `dockg stats` (which
 * reports and gates), and pinned by test/unit/schema-sync.ts against the
 * config schema so it cannot silently drift.
 */
import { NS } from "./vocab.js";

export interface CoverageField {
  /** Config/report key. */
  field: string;
  /** Full predicate IRI counted against `dockg:Document` subjects. */
  iri: string;
}

/**
 * Report order is this array's order. Only the IRI is stored; the compact form
 * shown in the report is derived from it with `compactIri`, so there is one
 * source of truth for the namespace.
 */
export const COVERAGE_FIELDS: readonly CoverageField[] = [
  { field: "title", iri: `${NS.dcterms}title` },
  { field: "description", iri: `${NS.dcterms}description` },
  { field: "creator", iri: `${NS.dcterms}creator` },
  { field: "created", iri: `${NS.dcterms}created` },
  { field: "modified", iri: `${NS.dcterms}modified` },
  { field: "subject", iri: `${NS.dcterms}subject` },
  { field: "prefLabel", iri: `${NS.foaf}primaryTopic` },
];

/** The measured field names, in report order. */
export const COVERAGE_FIELD_NAMES: readonly string[] = COVERAGE_FIELDS.map(
  (f) => f.field,
);
