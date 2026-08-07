class DefinitionsView {
  constructor() {
    this.selectList = atom.workspace.buildSelectList({
      className: "symbol",
      crumb: "Definitions",
      emptyMessage: "No definition found",
      filterKeyForItem: (item) => item.fileName,
      elementForItem: ({ text, fileName, line, type }) => {
        const [, relativePath] = atom.project.relativizePath(fileName);
        return { primary: `${type} ${text}`, secondary: `${relativePath}, line ${line + 1}` };
      },
      didConfirmSelection: (item) => {
        this.navigate(item);
      },
      didCancelSelection: () => {
        this.selectList.hide();
      },
    });
    this.selectList.show();
  }

  setItems(items) {
    this.selectList.update({ items });
  }

  navigate({ fileName, line, column }) {
    this.selectList.hide();
    atom.workspace.open(fileName, { pending: true }).then((editor) => {
      // An open can decline — an unreadable path, a full workspace center —
      // and then there is nowhere to place the cursor.
      if (!editor) return;
      editor.setCursorBufferPosition([line, column], { autoscroll: false });
      editor.scrollToCursorPosition({
        zone: atom.config.get("autocomplete-jedi.editorScrollZone"),
      });
    });
  }

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = DefinitionsView;
