const { CompositeDisposable } = require("lumine");

class RenameView {
  constructor(usages) {
    const n = usages.length;
    const { name } = usages[0];

    this.disposables = new CompositeDisposable();

    this.element = document.createElement("div");
    this.element.classList.add("autocomplete-jedi-rename");

    const label = document.createElement("div");
    label.classList.add("autocomplete-jedi-rename-label");
    label.textContent = `Type new name to replace ${n} occurrences of ${name} within project:`;
    this.element.appendChild(label);

    this.editor = lumine.workspace.buildTextEditor({ mini: true, placeholderText: name });
    this.disposables.add(lumine.textEditors.add(this.editor));
    const editorElement = lumine.views.getView(this.editor);
    this.element.appendChild(editorElement);

    this.panel = lumine.workspace.addModalPanel({ item: this.element, visible: true });
    editorElement.focus();

    this.disposables.add(lumine.commands.add(this.element, "core:cancel", () => this.destroy()));
  }

  destroy() {
    this.panel.hide();
    this.panel.destroy();
    this.editor.destroy();
    this.disposables.dispose();
  }

  onInput(callback) {
    const editorElement = lumine.views.getView(this.editor);
    this.disposables.add(
      lumine.commands.add(editorElement, {
        "core:confirm": () => {
          callback(this.editor.getText());
          this.destroy();
        },
      }),
    );
  }
}

module.exports = RenameView;
