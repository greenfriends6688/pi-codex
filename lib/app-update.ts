/**
 * This fork publishes GitHub releases, not npm packages — upstream owns the
 * `@agegr/pi-web` package on npm, so asking the registry for "latest" would
 * advertise a different product (and a version number from another line).
 */
export const RELEASE_REPO = "greenfriends6688/pinkslab";
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseStableVersion(version: string): [number, number, number] | null {
  const match = STABLE_VERSION_PATTERN.exec(version);
  if (!match) return null;

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts as [number, number, number];
}

export function isNewerStableVersion(candidate: string, current: string): boolean {
  const candidateParts = parseStableVersion(candidate);
  const currentParts = parseStableVersion(current);
  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

export function getPiWebReleaseUrl(version: string): string | null {
  if (!parseStableVersion(version)) return null;
  return `https://github.com/${RELEASE_REPO}/releases/tag/v${version}`;
}
