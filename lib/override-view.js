class OverrideView {
  constructor() {
    this.indent = 0;
    this.bufferPosition = null;

    this.selectList = lumine.workspace.buildSelectList({
      className: "symbol",
      crumb: "Overrides",
      loadingMessage: "Looking for methods…",
      emptyMessage: "No methods found",
      filterKeyForItem: (item) => item.name,
      elementForItem: ({ parent, name, fileName, line }) => {
        if (!line) {
          return { primary: `${parent}.${name}`, secondary: "builtin" };
        }
        const [, relativePath] = lumine.project.relativizePath(fileName);
        return { primary: `${parent}.${name}`, secondary: `${relativePath}, line ${line}` };
      },
      didConfirmSelection: (item) => {
        this.selectList.hide();
        this.insertOverride(item);
      },
      didCancelSelection: () => {
        this.selectList.hide();
      },
    });
    this.selectList.show();
  }

  insertOverride({ instance, name, params }) {
    const editor = lumine.workspace.getActiveTextEditor();
    const tabLength = editor.getTabLength();

    const line1 = `def ${name}(${["self"].concat(params).join(", ")}):`;
    const superCall = `super(${instance}, self).${name}(${params.join(", ")})`;
    const line2 = name === "__init__" ? superCall : `return ${superCall}`;

    if (this.indent < 1) {
      const tabText = editor.getTabText();
      editor.insertText(`${tabText}${line1}`);
      editor.insertNewlineBelow();
      editor.setTextInBufferRange(
        [
          [this.bufferPosition.row + 1, 0],
          [this.bufferPosition.row + 1, tabLength * 2],
        ],
        `${tabText}${tabText}${line2}`,
      );
    } else {
      const userIndent = editor.getTextInRange([
        [this.bufferPosition.row, 0],
        [this.bufferPosition.row, this.bufferPosition.column],
      ]);
      editor.insertText(line1);
      editor.insertNewlineBelow();
      editor.setTextInBufferRange(
        [
          [this.bufferPosition.row + 1, 0],
          [this.bufferPosition.row + 1, tabLength * 2],
        ],
        `${userIndent}${userIndent}${line2}`,
      );
    }
  }

  setItems(items) {
    this.selectList.update({ items, loadingMessage: null });
  }

  setError(error) {
    this.selectList.update({
      items: [],
      loadingMessage: null,
      status: { type: "error", message: `Could not look for methods: ${error.message}` },
    });
  }

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = OverrideView;
