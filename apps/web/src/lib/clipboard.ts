// Copy text to the clipboard, working in environments where the modern
// async Clipboard API is unavailable (HTTP origins that are not localhost,
// older browsers, iframes without permission, etc).
//
// Strategy:
// 1. Try `navigator.clipboard.writeText` — works on https:// and localhost.
// 2. Fall back to a temporary off-screen <textarea> + `document.execCommand('copy')`
//    — still supported by all major browsers as a deprecated API and required
//    for HTTP LAN URLs like http://192.168.x.y:3000 where clipboard.writeText
//    silently rejects with "NotAllowedError".
// 3. Resolve true on success, false on failure (caller can show a hint to copy manually).
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
    return ok;
  } catch {
    return false;
  }
}
