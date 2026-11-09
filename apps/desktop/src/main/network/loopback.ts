// The one definition of "a destination Holt may reach over HTTP": the literal
// loopback addresses, nothing else. Hostnames, other private ranges, userinfo
// and short forms such as 127.1 are all refused, so no name lookup can ever
// decide where a request goes.
const LOOPBACK_URL = /^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/i;

export function isLoopbackUrl(raw: string): boolean {
  if (!LOOPBACK_URL.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (url.hostname === "127.0.0.1" || url.hostname === "[::1]") && url.username === "" && url.password === "";
}
