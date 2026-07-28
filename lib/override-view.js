class OverrideView {
  constructor() {
    this.indent = 0;
    this.bufferPosition = null;
    this.items = null;

    this.session = atom.modals.open({
      id: "autocomplete-jedi.override",
      className: "symbols-view",
      placeholder: "Override a method",
      emptyMessage: "No methods found",
      source: (req) => {
        if (this.items) return this.items;
        req.progress({ busy: true, message: "Looking for methods" });
        return new Promise((resolve) => {
          this.resolveItems = resolve;
        });
      },
      renderer: {
        entry: (item) => ({ id: `${item.parent}.${item.name}`, text: item.name }),
        row: ({ parent, name, fileName, line }) => {
          if (!line) return { label: `${parent}.${name}`, detail: "builtin" };
          const [, relativePath] = atom.project.relativizePath(fileName);
          return { label: `${parent}.${name}`, detail: `${relativePath}, line ${line}` };
        },
      },
      confirm: ({ item, target }) => this.insertOverride(item, target.editor),
      didClose: () => {
        this.session = null;
      },
    });
  }

  // The editor is the one that had focus before the list opened, not whatever
  // is active now — confirming can only mean "into the buffer I came from".
  insertOverride({ instance, name, params }, editor) {
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
    this.items = items;
    if (this.resolveItems) {
      this.resolveItems(items);
      this.resolveItems = null;
    } else if (this.session) {
      this.session.refresh();
    }
  }

  destroy() {
    if (this.session) this.session.cancel("api");
  }
}

module.exports = OverrideView;
