class DefinitionsView {
  constructor() {
    this.selectList = lumine.workspace.buildSelectList({
      className: "symbol",
      crumb: "Definitions",
      emptyMessage: "No definition found",
      getItemId: ({ text, fileName, line, column, type }) =>
        JSON.stringify([fileName, line, column, type, text]),
      search: { getFilterText: (item) => item.fileName },
      renderItem: ({ text, fileName, line, type }) => {
        const [, relativePath] = lumine.project.relativizePath(fileName);
        return { primary: `${type} ${text}`, secondary: `${relativePath}, line ${line + 1}` };
      },
      commands: {
        "autocomplete-jedi:open-definition": {
          description: "Open the selected definition.",
          didDispatch: (event) => this.navigate(event.detail.item),
        },
      },
      actions: [
        {
          command: "autocomplete-jedi:open-definition",
          context: "item",
          primary: true,
          disposition: "close",
          dispatch: "local",
        },
      ],
    });
    this.selectList.show();
  }

  setItems(items) {
    return this.selectList.setItems(items);
  }

  navigate({ fileName, line, column }) {
    return lumine.workspace.open(fileName, { pending: true }).then((editor) => {
      // An open can decline — an unreadable path, a full workspace center —
      // and then there is nowhere to place the cursor.
      if (!editor) return;
      editor.setCursorBufferPosition([line, column], { autoscroll: false });
      editor.scrollToCursorPosition({
        zone: lumine.config.get("autocomplete-jedi.editorScrollZone"),
      });
    });
  }

  destroy() {
    return this.selectList.destroy();
  }
}

module.exports = DefinitionsView;
