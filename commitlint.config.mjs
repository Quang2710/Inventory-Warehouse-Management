/** Conventional Commits: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert(scope): mô tả */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
  },
};
