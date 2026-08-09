module.exports = {
  priority: 1,
  providerName: "autocomplete-jedi",
  disableForSelector:
    ".source.python .comment, .source.python .string, .source.python .numeric, .source.python .integer, .source.python .decimal, .source.python .punctuation, .source.python .keyword, .source.python .storage, .source.python .variable.parameter",
  constructed: false,

  constructor() {
    this.provider = require("./provider");
    this.log = require("./log");
    ({ selectorsMatchScopeChain: this.selectorsMatchScopeChain } = require("./scope-helpers"));
    this.constructed = true;
    this.log.debug("Loading python hyper-click provider...");
  },

  getScopes(editor, range) {
    return editor.scopeDescriptorForBufferPosition(range).scopes;
  },

  getSuggestionForWord(editor, text, range) {
    if (!this.constructed) {
      this.constructor();
    }
    if ([".", ":"].includes(text)) {
      return;
    }
    if (editor.getGrammar().scopeName.indexOf("source.python") > -1) {
      const bufferPosition = range.start;
      const scopeDescriptor = editor.scopeDescriptorForBufferPosition(bufferPosition);
      const scopeChain = scopeDescriptor.getScopeChain();
      if (this.selectorsMatchScopeChain(this.disableForSelector, scopeChain)) {
        return;
      }

      if (lumine.config.get("autocomplete-jedi.debugLogs")) {
        this.log.debug(range.start, this.getScopes(editor, range.start));
        this.log.debug(range.end, this.getScopes(editor, range.end));
      }
      const callback = () => {
        this.provider.load().goToDefinition(editor, bufferPosition);
      };
      return { range, callback };
    }
  },
};
