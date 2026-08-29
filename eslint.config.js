import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `allowExpressions`가 없으면 Jest의 `it('...', () => {})` 콜백마다 반환 타입을
      // 요구해 테스트가 전부 린트 오류가 된다. 함수 선언에만 반환 타입을 강제한다.
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // NestJS의 @Module()/@Controller() 선언은 본체가 빈 클래스다. 프레임워크의
      // 선언 문법이지 쓸데없는 클래스가 아니므로 데코레이터가 붙은 경우만 허용한다.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettierConfig,
);
