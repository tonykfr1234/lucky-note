/* Local-only display: no fetch, telemetry, persistence, or device identification. */
function renderViewport() {
  const viewport = window.visualViewport;
  const style = getComputedStyle(document.body);
  const value = {
    screen: { width: screen.width, height: screen.height },
    innerWidth: innerWidth,
    innerHeight: innerHeight,
    devicePixelRatio: devicePixelRatio,
    visualViewport: viewport ? { width: viewport.width, height: viewport.height, scale: viewport.scale, offsetTop: viewport.offsetTop, offsetLeft: viewport.offsetLeft } : null,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    pagePaddingIncludingSafeArea: { top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft },
  };
  document.getElementById('diagnostics').textContent = JSON.stringify(value, null, 2);
}
addEventListener('resize', renderViewport);
addEventListener('orientationchange', renderViewport);
window.visualViewport?.addEventListener('resize', renderViewport);
window.visualViewport?.addEventListener('scroll', renderViewport);
renderViewport();
