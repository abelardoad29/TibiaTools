/** Reglas de capas de docs/PLAN.md §5. */
module.exports = {
  forbidden: [
    {
      name: 'core-es-puro',
      comment: 'core no depende de electron, react, node ni de otras capas',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: ['^src/(main|preload|renderer)', 'node_modules/(electron|react|react-dom)/'], dependencyTypes: ['local', 'npm', 'core'] },
    },
    {
      name: 'core-sin-builtins',
      severity: 'error',
      from: { path: '^src/core' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'renderer-solo-via-platform',
      comment: 'el renderer no importa main ni preload',
      severity: 'error',
      from: { path: '^src/renderer' },
      to: { path: '^src/(main|preload)' },
    },
    {
      name: 'main-no-importa-renderer',
      severity: 'error',
      from: { path: '^src/(main|preload)' },
      to: { path: '^src/renderer' },
    },
    { name: 'sin-ciclos', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.node.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.json'] },
  },
}
