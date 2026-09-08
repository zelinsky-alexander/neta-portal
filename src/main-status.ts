const MARKER = /\s*\[(LATEST|NOT_LATEST|UNKNOWN)\]\s*$/;

function decorateBuildStatus(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('td.mono, .detail .mono')) {
    if (element.dataset.mainStatusDecorated === '1') continue;
    const text = element.textContent ?? '';
    const match = text.match(MARKER);
    if (!match) continue;

    const status = match[1];
    const build = text.replace(MARKER, '').trim();
    element.textContent = build;
    const badge = document.createElement('span');
    badge.className = `badge ${status === 'LATEST' ? 'ok' : status === 'NOT_LATEST' ? 'warn' : 'muted'} main-build-badge`;
    badge.textContent = status === 'NOT_LATEST' ? 'NOT LATEST' : status;
    badge.title = status === 'LATEST'
      ? 'Installed agent commit matches the current neta-agent main branch'
      : status === 'NOT_LATEST'
        ? 'Installed agent commit does not match the current neta-agent main branch'
        : 'Latest main status is unavailable';
    element.append(' ', badge);
    element.dataset.mainStatusDecorated = '1';
  }
}

const observer = new MutationObserver(() => decorateBuildStatus());
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
decorateBuildStatus();
