import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Operations banned inside `packages/core/src/kernel/**`.
 *
 * Transcendentals have implementation-defined precision — V8, SpiderMonkey and
 * JavaScriptCore demonstrably differ in the last bits — so they cannot appear
 * anywhere output-affecting. `Math.random` is nondeterministic by definition.
 * See docs/requirements/phase0-spike-plan.md §A.1.
 */
const BANNED_MATH = [
  'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1',
  'log', 'log2', 'log10', 'log1p',
  'pow', 'cbrt', 'hypot',
  'random',
];

const kernelRestrictedProperties = BANNED_MATH.map((name) => ({
  object: 'Math',
  property: name,
  message:
    `Math.${name} is not bit-identical across JS engines and is banned in the kernel. ` +
    'Use a whitelisted approximation from kernel/approx.ts, or add one there.',
}));

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/target/**', '**/pkg/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
  },
  {
    // The whitelisted zone. Anything that reaches generated output — and
    // therefore a golden hash — lives here and obeys the op whitelist.
    files: ['packages/core/src/kernel/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...kernelRestrictedProperties],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Date makes generation time-dependent; banned in the kernel.' },
        { name: 'Intl', message: 'Intl is locale-dependent; banned in the kernel.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'BinaryExpression[operator="**"]',
          message: 'The ** operator resolves to Math.pow semantics. Use powi() from kernel/ops.ts.',
        },
        {
          selector: 'AssignmentExpression[operator="**="]',
          message: 'The **= operator resolves to Math.pow semantics. Use powi() from kernel/ops.ts.',
        },
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'Date makes generation time-dependent; banned in the kernel.',
        },
        {
          selector: 'CallExpression[callee.property.name="sort"][arguments.length=0]',
          message:
            'sort() without a comparator is implementation-defined for non-string keys. ' +
            'Pass an explicit total-order comparator.',
        },
      ],
    },
  },
  {
    files: ['**/*.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
);
