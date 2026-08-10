class UsagesView {
  constructor() {
    this.selectList = lumine.workspace.buildSelectList({
      className: "symbol",
      crumb: "Usages",
      loadingMessage: "Looking for usages…",
      emptyMessage: "No usages found",
      filterKeyForItem: (item) => item.fileName,
      elementForItem: ({ name, fileName, line }) => {
        const [, relativePath] = lumine.project.relativizePath(fileName);
        return { primary: name, secondary: `${relativePath}, line ${line}` };
      },
      didChangeSelection: (item) => {
        if (!item) return;
        const editor = lumine.workspace.getActiveTextEditor();
        if (editor && editor.getBuffer().file?.path === item.fileName) {
          editor.setSelectedBufferRange(
            [
              [item.line - 1, item.column],
              [item.line - 1, item.column + item.name.length],
            ],
            { autoscroll: false },
          );
          editor.scrollToCursorPosition({
            zone: lumine.config.get("autocomplete-jedi.editorScrollZone"),
          });
        }
      },
      didConfirmSelection: (item) => {
        this.selectList.hide();
        lumine.workspace.open(item.fileName).then((editor) => {
          // An open can decline — an unreadable path, a full workspace center —
          // and then there is nowhere to place the cursor.
          if (!editor) return;
          editor.setCursorBufferPosition([item.line - 1, item.column], { autoscroll: false });
          editor.setSelectedBufferRange(
            [
              [item.line - 1, item.column],
              [item.line - 1, item.column + item.name.length],
            ],
            { autoscroll: false },
          );
          editor.scrollToCursorPosition({
            zone: lumine.config.get("autocomplete-jedi.editorScrollZone"),
          });
        });
      },
      didCancelSelection: () => {
        this.selectList.hide();
      },
    });
    this.selectList.show();
  }

  setItems(items) {
    this.selectList.update({ items, loadingMessage: null });
  }

  setError(error) {
    this.selectList.update({
      items: [],
      loadingMessage: null,
      status: { type: "error", message: `Could not look for usages: ${error.message}` },
    });
  }

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = UsagesView;
