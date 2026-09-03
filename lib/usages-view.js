class UsagesView {
  constructor() {
    this.selectList = lumine.workspace.buildSelectList({
      className: "symbol",
      crumb: "Usages",
      loadingMessage: "Looking for usages…",
      emptyMessage: "No usages found",
      getItemId: ({ name, fileName, line, column }) =>
        JSON.stringify([fileName, line, column, name]),
      search: { getFilterText: (item) => item.fileName },
      renderItem: ({ name, fileName, line }) => {
        const [, relativePath] = lumine.project.relativizePath(fileName);
        return { primary: name, secondary: `${relativePath}, line ${line}` };
      },
      commands: {
        "autocomplete-jedi:open-usage": {
          description: "Open the selected symbol usage.",
          didDispatch: (event) => this.navigate(event.detail.item),
        },
      },
      actions: [
        {
          command: "autocomplete-jedi:open-usage",
          context: "item",
          primary: true,
          disposition: "close",
          dispatch: "local",
        },
      ],
    });
    this.selectList.onDidChangeSelection(({ item }) => this.preview(item));
    this.selectList.show();
  }

  preview(item) {
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
  }

  navigate(item) {
    return lumine.workspace.open(item.fileName).then((editor) => {
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
  }

  setItems(items) {
    this.selectList.clearLoadingState();
    return this.selectList.setItems(items);
  }

  setError(error) {
    this.selectList.setItems([]);
    this.selectList.clearLoadingState();
    return this.selectList.setStatus({
      type: "error",
      message: `Could not look for usages: ${error.message}`,
    });
  }

  destroy() {
    return this.selectList.destroy();
  }
}

module.exports = UsagesView;
