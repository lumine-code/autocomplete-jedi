module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "jedi-tools",
      tips: [
        "In Python files you can jump to the definition of the symbol under the cursor with {{ 'jedi-tools:go-to-definition' | keystroke }}",
      ],
    };
  },

  activate() {
    this.disposables = [
      lumine.commands.add("lumine-workspace", "jedi-tools:go-to-definition", {
        description: "Jump to where the symbol under the cursor is defined.",
        didDispatch: (event) =>
          this.withPythonEditor(event, (editor) => this.ensureTools().goToDefinition(editor)),
      }),
      lumine.commands.add("lumine-workspace", "jedi-tools:show-usages", {
        description: "List everywhere the symbol under the cursor is used.",
        didDispatch: (event) =>
          this.withPythonEditor(event, (editor) => this.ensureTools().showUsages(editor)),
      }),
      lumine.commands.add("lumine-workspace", "jedi-tools:override-method", {
        description: "Insert a stub overriding a method of the base class.",
        didDispatch: (event) =>
          this.withPythonEditor(event, (editor) => this.ensureTools().showOverrideMethods(editor)),
      }),
      lumine.commands.add("lumine-workspace", "jedi-tools:rename", {
        description: "Rename the symbol under the cursor everywhere it appears.",
        didDispatch: (event) =>
          this.withPythonEditor(event, (editor) => this.ensureTools().rename(editor)),
      }),
      lumine.commands.add("lumine-workspace", "jedi-tools:add-roots-to-extra-paths", {
        description: "Put the project folders on the paths Jedi searches.",
        didDispatch: () => this.addRootsToExtraPaths(),
      }),
    ];

    this.hyperclickProvider = {
      priority: 1,
      providerName: "jedi-tools",
      disableForSelector:
        ".source.python .comment, .source.python .string, .source.python .constant.numeric, .source.python .punctuation, .source.python .keyword, .source.python .storage, .source.python .variable.parameter",
      getSuggestionForWord: (editor, text, range) => {
        if ([".", ":"].includes(text) || !editor.getGrammar().scopeName.includes("source.python")) {
          return;
        }
        const lifetime = this.disposables;
        return {
          range,
          callback: () => {
            if (this.disposables === lifetime) {
              return this.ensureTools().goToDefinition(editor, range.start);
            }
          },
        };
      },
    };
  },

  ensureTools() {
    this.tools ||= require("./tools");
    return this.tools.load();
  },

  withPythonEditor(event, callback) {
    const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
    const editor = element?.getModel?.() ?? lumine.workspace.getActiveTextEditor() ?? null;
    if (!editor) return;
    if (!editor.getGrammar().scopeName.includes("source.python")) {
      lumine.notifications.addWarning("Jedi Tools requires a Python editor.");
      return;
    }
    return callback(editor);
  },

  addRootsToExtraPaths() {
    const current = lumine.config
      .get("jedi-tools.extraPaths")
      .split(";")
      .map((path) => path.trim())
      .filter(Boolean);
    let added = 0;
    for (const root of lumine.project.getPaths()) {
      if (!current.includes(root)) {
        current.push(root);
        added++;
      }
    }
    lumine.config.set("jedi-tools.extraPaths", current.join(";"));
    if (added > 0) {
      lumine.notifications.addSuccess(`jedi-tools: added ${added} project root(s) to Extra Paths.`);
    } else {
      lumine.notifications.addInfo("jedi-tools: all project roots are already in Extra Paths.");
    }
  },

  deactivate() {
    for (const disposable of this.disposables || []) {
      disposable.dispose();
    }
    this.disposables = null;
    this.tools?.dispose();
    this.tools = null;
    this.hyperclickProvider = null;
  },

  provideHyperclick() {
    return this.hyperclickProvider;
  },
};
