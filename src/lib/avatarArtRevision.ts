/** Artwork revision measured alongside bust gain and crown bounds. */
export const AVATAR_ART_REVISION = '01583720e532bebe42bf';

/** Request the complete 2x artwork without changing persisted avatar identities. */
export function versionedTableAvatarArt(source: string): string {
  const match =
    /^((?:https?:\/\/[^/]+)?\/avatars\/table\/(?:free|vip)_[\w-]+?)(?:@2x)?\.(?:png|webp)(?:[?#].*)?$/.exec(
      source
    );
  return match ? `${match[1]}@2x.webp?art=${AVATAR_ART_REVISION}` : source;
}
