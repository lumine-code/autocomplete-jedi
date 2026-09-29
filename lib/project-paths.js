const path = require("path");

module.exports = {
  applySubstitutions(paths) {
    return [
      ...new Set(
        paths.flatMap((template) => {
          if (!/\$PROJECT(?:_NAME)?\b/i.test(template)) return [template];
          return lumine.project
            .getPaths()
            .map((project) =>
              template
                .replace(/\$PROJECT_NAME\b/gi, () => path.basename(project))
                .replace(/\$PROJECT\b/gi, () => project),
            );
        }),
      ),
    ];
  },
};
