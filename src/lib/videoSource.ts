export type VideoSource = { kind: 'embed' | 'file'; src: string };

/** Never load an arbitrary webpage as a video or substitute another source. */
export function resolveVideoSource(value?: string | null): VideoSource | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'loom.com' || host === 'www.loom.com') {
      const match = url.pathname.match(/^\/(?:share|embed)\/([a-f0-9]{32})\/?$/i);
      if (!match) return null;
      url.hostname = 'www.loom.com';
      url.pathname = `/embed/${match[1]}`;
      return {kind: 'embed', src: url.toString()};
    }
    if (['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(host) && /^\/embed\/[\w-]+\/?$/.test(url.pathname)) {
      return {kind: 'embed', src: url.toString()};
    }
    if (host === 'player.vimeo.com' && /^\/video\/\d+\/?$/.test(url.pathname)) {
      return {kind: 'embed', src: url.toString()};
    }
    if (/\.(mp4|webm|ogg|ogv|mov)$/i.test(url.pathname)) return {kind: 'file', src: url.toString()};
    return null;
  } catch { return null; }
}
