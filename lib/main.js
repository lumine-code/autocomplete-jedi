const { CompositeDisposable } = require("atom");

module.exports = {
  handleGrammarChangeEvent(grammar) {
    // this should be same with activationHooks names
    if (["language-python", "MagicPython", "atom-django"].includes(grammar.packageName)) {
      this.provider.load();
      this.disposables.dispose();
    }
  },

  load() {
    this.disposables = new CompositeDisposable();
    const editorObserver = atom.workspace.observeTextEditors((editor) => {
      this.handleGrammarChangeEvent(editor.getGrammar());
      this.disposables.add(
        editor.onDidChangeGrammar((grammar) => {
          this.handleGrammarChangeEvent(grammar);
        }),
      );
    });
    this.disposables.add(editorObserver);
  },

  activate() {
    this.provider = require("./provider");
    if (
      typeof atom.packages.hasActivatedInitialPackages === "function" &&
      atom.packages.hasActivatedInitialPackages()
    ) {
      this.load();
    } else {
      let disposable = atom.packages.onDidActivateInitialPackages(() => {
        this.load();
        disposable.dispose();
      });
    }
  },

  deactivate() {
    if (this.provider) {
      this.provider.dispose();
    }
  },

  provideAutocomplete() {
    return this.provider;
  },

  provideHyperclick() {
    return require("./hyperclick-provider");
  },
};
