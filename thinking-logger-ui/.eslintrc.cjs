/* eslint-env node */
module.exports = {
	root: true,
	env: { node: true, es2022: true },
	parser: '@typescript-eslint/parser',
	parserOptions: { ecmaVersion: 'latest', sourceType: 'module', project: false },
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:@typescript-eslint/strict-type-checked',
		'plugin:@typescript-eslint/stylistic-type-checked',
		'prettier',
	],
	plugins: ['@typescript-eslint'],
	rules: {
		'@typescript-eslint/explicit-function-return-type': 'off',
		'@typescript-eslint/no-floating-promises': 'error',
		'@typescript-eslint/consistent-type-imports': 'error',
		'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		'@typescript-eslint/prefer-nullish-coalescing': 'error',
	},
	overrides: [
		{
			files: ['src/webview/**/*.ts'],
			rules: {
				'@typescript-eslint/no-unsafe-assignment': 'off',
				'@typescript-eslint/no-unsafe-member-access': 'off',
			},
		},
	],
};


