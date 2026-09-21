const { CompositeDisposable } = require("lumine");

module.exports = {
  handleGrammarChangeEvent(grammar) {
    // Keep the provider focused on the grammars it actually supports.
    if (["language-python", "language-ipython"].includes(grammar.packageName)) {
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
    // Bootstrap the lightweight provider facade; expensive work remains behind
    // the provider's normal use paths.
    this.provider.load();
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
