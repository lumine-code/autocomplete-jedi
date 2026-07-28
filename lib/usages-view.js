const { scrollToCursorWithMode } = require("./scroll");

const VIEW_ID = "autocomplete-jedi.usages";

// The usage list. Moving through it moves the editor — that is the point of the
// list — so it previews through a real pending pane item rather than the
// read-only column, and the kernel restores every editor it disturbed if the
// list is cancelled instead of confirmed.
class UsagesView {
  constructor() {
    this.items = null;
    this.session = atom.modals.open({
      id: VIEW_ID,
      className: "symbols-view",
      placeholder: "Find a usage",
      emptyMessage: "No usages found",
      // The lookup is already in flight when the view opens, so the source
      // waits for it rather than the list opening empty and being pushed into.
      source: (req) => {
        if (this.items) return this.items;
        req.progress({ busy: true, message: "Looking for usages" });
        return new Promise((resolve) => {
          this.resolveItems = resolve;
        });
      },
      preview: atom.modals.previewers.paneItem((item) => ({
        uri: item.fileName,
        initialLine: item.line - 1,
        initialColumn: item.column,
      })),
      renderer: {
        entry: (item) => ({
          id: `${item.fileName}:${item.line}:${item.column}`,
          text: item.fileName,
        }),
        row: (item) => {
          const [, relativePath] = atom.project.relativizePath(item.fileName);
          return { label: item.name, detail: `${relativePath}, line ${item.line}` };
        },
      },
      confirm: async ({ item }) => {
        const editor = await atom.workspace.open(item.fileName);
        editor.setCursorBufferPosition([item.line - 1, item.column], { autoscroll: false });
        editor.setSelectedBufferRange(
          [
            [item.line - 1, item.column],
            [item.line - 1, item.column + item.name.length],
          ],
          { autoscroll: false },
        );
        scrollToCursorWithMode(editor);
      },
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

  destroy() {
    if (this.session) this.session.cancel("api");
  }
}

module.exports = UsagesView;
