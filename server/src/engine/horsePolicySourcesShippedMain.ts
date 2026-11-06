/**
 * IMAGE BUILD GATE: every hashed Horse policy source ships in the engine image.
 *
 * server/Dockerfile runs this emitted entry (dist/engine/...) right after the
 * runtime emit, inside the image, so the server root it reads from is /app.
 * A hashed path the image does not carry fails the image build here with the
 * list of missing paths, before any release can ship an engine whose policy
 * digests are null and whose forced phases silently sit in shadow (the Nov 5
 * releases 67bc0e85, 8017564a and 71087373; see HorsePolicySourceManifest.ts).
 *
 * Standalone entry only: nothing imports it.
 */
import {
  describeUnreadableHorsePolicySources,
  horsePolicySourceManifest,
  unreadableHorsePolicySources,
} from './HorsePolicySourceManifest.js';

const unreadable = unreadableHorsePolicySources();
if (unreadable.length > 0) {
  console.error(
    `[verify-horse-policy-sources-shipped] ${describeUnreadableHorsePolicySources(unreadable)}`
  );
  process.exit(1);
}
console.log(
  `[verify-horse-policy-sources-shipped] every hashed Horse policy source is readable: ${horsePolicySourceManifest().length} files`
);
