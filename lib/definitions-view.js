const { scrollToCursorWithMode } = require("./scroll");

// The definition list. Opened only when there is more than one candidate — the
// provider jumps straight there for a single result — so it always has
// something to choose between.
class DefinitionsView {
  constructor() {
    this.items = null;
    this.session = atom.modals.open({
      id: "autocomplete-jedi.definitions",
      className: "symbols-view",
      placeholder: "Go to a definition",
      emptyMessage: "No definition found",
      source: (req) => {
        if (this.items) return this.items;
        req.progress({ busy: true });
        return new Promise((resolve) => {
          this.resolveItems = resolve;
        });
      },
      renderer: {
        entry: (item) => ({
          id: `${item.fileName}:${item.line}:${item.column}`,
          text: item.fileName,
        }),
        row: ({ text, fileName, line, type }) => {
          const [, relativePath] = atom.project.relativizePath(fileName);
          return { label: `${type} ${text}`, detail: `${relativePath}, line ${line + 1}` };
        },
      },
      confirm: ({ item }) => this.navigate(item),
      didClose: () => {
        this.session = null;
      },
    });
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

  async navigate({ fileName, line, column }) {
    const editor = await atom.workspace.open(fileName, { pending: true });
    editor.setCursorBufferPosition([line, column], { autoscroll: false });
    scrollToCursorWithMode(editor);
  }

  destroy() {
    if (this.session) this.session.cancel("api");
  }
}

module.exports = DefinitionsView;
