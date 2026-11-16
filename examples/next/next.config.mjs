// This project sits inside the flythrough repo, which has its own lockfile:
// say that the project's root is this folder.
const root = import.meta.dirname;

export default {
  outputFileTracingRoot: root,
  turbopack: { root },
};
