// Publish guard: refuse to publish while any dependency uses a local
// file:/link: spec — npm copies dependencies into the tarball verbatim, so a
// published file:../docmeta would break every consumer's install. Runs from
// prepublishOnly; replace the spec with a semver range once docmeta is
// published, and this guard goes quiet.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const offenders = [];
for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
    if (/^(file|link):/.test(spec)) offenders.push(`${section}.${name}: ${spec}`);
  }
}
if (offenders.length > 0) {
  console.error(
    `Refusing to publish: local dependency specs would ship in the tarball:\n  ${offenders.join("\n  ")}`,
  );
  process.exit(1);
}
