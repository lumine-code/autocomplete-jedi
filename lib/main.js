module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "autocomplete-jedi",
      tips: [
        "In Python files you can jump to the definition of the symbol under the cursor with {{ 'autocomplete-jedi:go-to-definition' | keystroke }}",
      ],
    };
  },

  activate() {
    const selector = "lumine-text-editor[data-grammar~=python]:not([mini])";

    this.disposables = [
      lumine.commands.add(selector, "autocomplete-jedi:go-to-definition", {
        description: "Jump to where the symbol under the cursor is defined.",
        didDispatch: () => this.ensureProvider().goToDefinition(),
      }),
      lumine.commands.add(selector, "autocomplete-jedi:show-usages", {
        description: "List everywhere the symbol under the cursor is used.",
        didDispatch: () => this.ensureProvider().showUsages(),
      }),
      lumine.commands.add(selector, "autocomplete-jedi:override-method", {
        description: "Insert a stub overriding a method of the base class.",
        didDispatch: () => this.ensureProvider().showOverrideMethods(),
      }),
      lumine.commands.add(selector, "autocomplete-jedi:rename", {
        description: "Rename the symbol under the cursor everywhere it appears.",
        didDispatch: () => this.ensureProvider().rename(),
      }),
      lumine.commands.add("lumine-workspace", "autocomplete-jedi:add-roots-to-extra-paths", {
        description: "Put the project folders on the paths Jedi searches.",
        didDispatch: () => this.addRootsToExtraPaths(),
      }),
    ];

    this.autocompleteProvider = {
      scopeSelector: ".source.python",
      disableForScopeSelector: ".source.python .comment, .source.python .string",
      inclusionPriority: 2,
      get suggestionPriority() {
        return lumine.config.get("autocomplete-jedi.priority");
      },
      excludeLowerPriority: false,
      getSuggestions: (request) => this.ensureProvider().getSuggestions(request),
    };
    this.hyperclickProvider = {
      priority: 1,
      providerName: "autocomplete-jedi",
      disableForSelector:
        ".source.python .comment, .source.python .string, .source.python .numeric, .source.python .integer, .source.python .decimal, .source.python .punctuation, .source.python .keyword, .source.python .storage, .source.python .variable.parameter",
      getSuggestionForWord: (...args) =>
        require("./hyperclick-provider").getSuggestionForWord(...args),
    };
  },

  ensureProvider() {
    this.provider ||= require("./provider");
    return this.provider.load();
  },

  addRootsToExtraPaths() {
    const current = lumine.config
      .get("autocomplete-jedi.extraPaths")
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
    lumine.config.set("autocomplete-jedi.extraPaths", current.join(";"));
    if (added > 0) {
      lumine.notifications.addSuccess(
        `autocomplete-jedi: added ${added} project root(s) to Extra Paths.`,
      );
    } else {
      lumine.notifications.addInfo(
        "autocomplete-jedi: all project roots are already in Extra Paths.",
      );
    }
  },

  deactivate() {
    for (const disposable of this.disposables || []) {
      disposable.dispose();
    }
    this.disposables = null;
    this.provider?.dispose();
    this.provider = null;
    this.autocompleteProvider = null;
    this.hyperclickProvider = null;
  },

  provideAutocomplete() {
    return this.autocompleteProvider;
  },

  provideHyperclick() {
    return this.hyperclickProvider;
  },
};
