const { CompositeDisposable } = require("lumine");

module.exports = {
  handleGrammarChangeEvent(grammar) {
    // this should be same with activationHooks names
    if (["language-python", "MagicPython"].includes(grammar.packageName)) {
      this.provider.load();
      this.disposables.dispose();
    }
  },

  load() {
    this.disposables = new CompositeDisposable();
    const editorObserver = lumine.workspace.observeTextEditors((editor) => {
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
      typeof lumine.packages.hasActivatedInitialPackages === "function" &&
      lumine.packages.hasActivatedInitialPackages()
    ) {
      this.load();
    } else {
      let disposable = lumine.packages.onDidActivateInitialPackages(() => {
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
