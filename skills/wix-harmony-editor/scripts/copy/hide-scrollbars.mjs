// Make the editor's canvas widths independent of the OS scrollbar setting.
// With classic (always visible) scrollbars the stage loses 15 px: a desktop section reads 1265
// instead of 1280 and a mobile one 375 instead of 390, so every composition lands off and a
// deploy reports dozens of differences. Hiding scrollbars over CDP fixes that, but only while
// the CDP session stays attached, so each script that reads or writes layout calls this itself.
// The editor re-measures on a breakpoint switch, which is done here.
export async function hideScrollbars(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setScrollbarsHidden', { hidden: true });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const api = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' });
    await api.execute({ code: 'await editorLLMApis.breakpoints.toggle({ device: "mobile" }); await editorLLMApis.breakpoints.toggle({ device: "desktop" }); return true;' }, { biParams: {} });
  });
  return cdp;
}
