const { scrollToCursorWithMode } = require("./scroll");

class UsagesView {
  constructor() {
    this.selectList = atom.workspace.buildSelectList({
      className: "symbols-view",
      loadingMessage: "Looking for usages",
      emptyMessage: "No usages found",
      filterKeyForItem: (item) => item.fileName,
      elementForItem: ({ name, fileName, line }) => {
        const [, relativePath] = atom.project.relativizePath(fileName);
        return { primary: name, secondary: `${relativePath}, line ${line}` };
      },
      didChangeSelection: (item) => {
        if (!item) return;
        const editor = atom.workspace.getActiveTextEditor();
        if (editor && editor.getBuffer().file?.path === item.fileName) {
          editor.setSelectedBufferRange(
            [
              [item.line - 1, item.column],
              [item.line - 1, item.column + item.name.length],
            ],
            { autoscroll: false },
          );
          scrollToCursorWithMode(editor);
        }
      },
      didConfirmSelection: (item) => {
        this.selectList.hide();
        atom.workspace.open(item.fileName).then((editor) => {
          editor.setCursorBufferPosition([item.line - 1, item.column], { autoscroll: false });
          editor.setSelectedBufferRange(
            [
              [item.line - 1, item.column],
              [item.line - 1, item.column + item.name.length],
            ],
            { autoscroll: false },
          );
          scrollToCursorWithMode(editor);
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

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = UsagesView;
