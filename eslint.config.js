import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.generated-test/**'] },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-constant-binary-expression': 'error',
      'no-irregular-whitespace': 'error',
    },
  },
);
