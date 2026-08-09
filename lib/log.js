module.exports = {
  prefix: "autocomplete-jedi:",
  debug(...msg) {
    if (lumine.config.get("autocomplete-jedi.debugLogs")) {
      console.debug(this.prefix, ...msg);
    }
  },

  warning(...msg) {
    console.warn(this.prefix, ...msg);
  },
};
