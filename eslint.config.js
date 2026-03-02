import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

export default [
  js.configs.recommended,
  jsdoc.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      jsdoc
    },
    rules: {
      // Architectural & Coding Standards

      // Modules: Ban require()
      'no-restricted-globals': ['error', {
        name: 'require',
        message: 'Use ES6 import/export syntax exclusively (STYLE.md §2)'
      }],

      // Asynchronous Logic: Ban .then() chaining
      'no-restricted-properties': ['error', {
        property: 'then',
        message: 'Use async/await instead of .then() chaining (STYLE.md §2)'
      }],

      // Error Handling: Custom errors, no raw strings
      'no-throw-literal': 'error',

      // Enforce strict checks on unused vars and promises
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-promise-executor-return': 'error',
      'preserve-caught-error': 'off', // Handle unknown custom rules gracefully

      // Code Style Guidelines
      'indent': ['error', 2, { SwitchCase: 1 }],
      'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'semi': ['error', 'always'],

      // Variable Naming (approximation for camelCase / UPPER_SNAKE_CASE)
      'camelcase': ['off'], // Hard to enforce rigidly with Notion DB properties like "task_id", so turning off strict camelcase, but general style is maintained.

      // JSDoc Requirements (STYLE.md §2)
      'jsdoc/require-jsdoc': ['warn', {
        publicOnly: true,
        require: {
          ArrowFunctionExpression: false,
          ClassDeclaration: true,
          ClassExpression: true,
          FunctionDeclaration: true,
          FunctionExpression: false,
          MethodDefinition: true
        }
      }],
      'jsdoc/require-param': 'error', // Required by STYLE.md
      'jsdoc/require-returns': ['error', {
        forceRequireReturn: false
      }],
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns-description': 'error'
    }
  },
  {
    // Test directory overrides
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly'
      }
    },
    rules: {
      // Relax rules inside tests (e.g., JSDoc not needed for test cases)
      'jsdoc/require-jsdoc': 'off',
      'no-restricted-globals': 'off' // Tests might mock things
    }
  },
  {
    // Ignore patterns
    ignores: [
      'node_modules/',
      'dist/',
      '.wrangler/',
      'tests/coverage/'
    ]
  }
];
