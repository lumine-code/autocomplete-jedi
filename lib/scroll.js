function scrollToCursorWithMode(editor) {
  const scroll = atom.config.get("autocomplete-jedi.editorScrollPosition");
  const [upper, lower] = scroll.split("-").map(Number);
  const editorView = atom.views.getView(editor);
  const cursorRow = editor.getCursorScreenPosition().row;
  const cursorPixel = editorView.component.pixelPositionAfterBlocksForRow(cursorRow);
  const viewHeight = editorView.component.getScrollContainerClientHeight();
  const margin = editorView.component.getVerticalAutoscrollMargin();
  const lineHeight = editorView.component.getLineHeight();
  const usable = viewHeight - 2 * margin - lineHeight;
  const toPixel = (pct) => margin + usable * (pct / 100);
  const upperPixel = toPixel(upper);
  if (lower === undefined) {
    editorView.setScrollTop(cursorPixel - upperPixel);
  } else {
    const currentScrollTop = editorView.getScrollTop();
    const cursorRelative = cursorPixel - currentScrollTop;
    const lowerPixel = toPixel(lower);
    if (cursorRelative < upperPixel) {
      editorView.setScrollTop(cursorPixel - upperPixel);
    } else if (cursorRelative > lowerPixel) {
      editorView.setScrollTop(cursorPixel - lowerPixel);
    }
  }
}

module.exports = { scrollToCursorWithMode };
