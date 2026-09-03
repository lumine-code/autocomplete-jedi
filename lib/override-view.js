class OverrideView {
  constructor() {
    this.indent = 0;
    this.bufferPosition = null;

    this.selectList = lumine.workspace.buildSelectList({
      className: "symbol",
      crumb: "Overrides",
      loadingMessage: "Looking for methods…",
      emptyMessage: "No methods found",
      getItemId: ({ parent, instance, name, params, fileName, line, column }) =>
        JSON.stringify([
          fileName ?? null,
          line ?? null,
          column ?? null,
          parent,
          instance,
          name,
          params,
        ]),
      search: { getFilterText: (item) => item.name },
      renderItem: ({ parent, name, fileName, line }) => {
        if (!line) {
          return { primary: `${parent}.${name}`, secondary: "builtin" };
        }
        const [, relativePath] = lumine.project.relativizePath(fileName);
        return { primary: `${parent}.${name}`, secondary: `${relativePath}, line ${line}` };
      },
      commands: {
        "autocomplete-jedi:insert-override": {
          description: "Insert an override for the selected base method.",
          didDispatch: (event) => this.insertOverride(event.detail.item),
        },
      },
      actions: [
        {
          command: "autocomplete-jedi:insert-override",
          context: "item",
          primary: true,
          disposition: "close",
          dispatch: "local",
        },
      ],
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
    this.selectList.clearLoadingState();
    return this.selectList.setItems(items);
  }

  setError(error) {
    this.selectList.setItems([]);
    this.selectList.clearLoadingState();
    return this.selectList.setStatus({
      type: "error",
      message: `Could not look for methods: ${error.message}`,
    });
  }

  destroy() {
    return this.selectList.destroy();
  }
}

module.exports = OverrideView;
