/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules harder to reason about and test.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'core-is-independent',
      severity: 'error',
      comment: 'src/core must not depend on game, render, ui, input, or audio layers.',
      from: { path: '^src/core/' },
      to: { path: '^src/(game|render|ui|input|audio)/' },
    },
    {
      name: 'game-no-ui-or-render-deps',
      severity: 'error',
      comment: 'src/game (domain logic) must stay decoupled from render, ui, input, and audio.',
      from: { path: '^src/game/' },
      to: { path: '^src/(render|ui|input|audio)/' },
    },
    {
      name: 'audio-input-no-ui-render',
      severity: 'error',
      comment: 'src/audio and src/input must not depend on render or ui layers.',
      from: { path: '^src/(audio|input)/' },
      to: { path: '^src/(render|ui)/' },
    },
    {
      name: 'no-depend-on-main',
      severity: 'error',
      comment: 'No module should import the application entrypoint src/main.ts.',
      from: { pathNot: '^src/main\\.ts$' },
      to: { path: '^src/main\\.ts$' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    doNotFollow: {
      path: 'node_modules',
    },
  },
};
