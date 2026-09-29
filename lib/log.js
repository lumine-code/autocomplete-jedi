module.exports = {
  prefix: "jedi-tools:",
  debug(...msg) {
    if (lumine.config.get("jedi-tools.debugLogs")) {
      console.debug(this.prefix, ...msg);
    }
  },

  warning(...msg) {
    console.warn(this.prefix, ...msg);
  },
};
