const path = require("path");

module.exports = {
  applySubstitutions(paths) {
    const modPaths = [];
    for (let p of paths) {
      if (/\$PROJECT/.test(p)) {
        for (const project of lumine.project.getPaths()) {
          const projectName = project.split(path.sep).at(-1);
          p = p.replace(/\$PROJECT_NAME/i, projectName);
          p = p.replace(/\$PROJECT/i, project);
          if (!modPaths.includes(p)) {
            modPaths.push(p);
          }
        }
      } else {
        modPaths.push(p);
      }
    }
    return modPaths;
  },
};
